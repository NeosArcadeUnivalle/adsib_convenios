<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

class AssistantController extends Controller
{
    /** Configuración IA (Ollama) */
    private string $ollamaUrl;
    private string $ollamaModel;
    private int    $ollamaTimeout;

    public function __construct()
    {
        $this->ollamaUrl    = rtrim(env('OLLAMA_URL', 'http://127.0.0.1:11434'), '/');
        $this->ollamaModel  = env('OLLAMA_MODEL', 'llama3:latest');
        $this->ollamaTimeout= (int) env('OLLAMA_TIMEOUT', 45); // seg
    }

    /** -------------------------------------------------------------
     *  Punto de entrada principal: POST /api/assistant/chat
     *  Body: { message: string, context?: { convenio_id?, version_id? } }
     *  Respuesta: { reply: string, grounding: {...} }
     * --------------------------------------------------------------*/
    public function chat(Request $r)
    {
        $msg      = trim((string)($r->input('message') ?? ''));
        $context  = (array) ($r->input('context') ?? []);
        if ($msg === '') {
            return response()->json([
                'reply' => 'Escribe tu consulta…',
                'grounding' => ['type'=>'none']
            ], 200);
        }

        // 1) Intentos de “short-circuit” (respuestas directas a BD)
        $direct = $this->tryDirectAnswers($msg, $context);
        if ($direct) {
            return response()->json($direct, 200);
        }

        // 2) RAG: juntamos contexto desde BD relacionado con la consulta
        $ground = $this->buildGrounding($msg, $context);

        // 3) Pedimos a Ollama una respuesta con ese grounding
        try {
            $reply = $this->askOllama($msg, $ground['context_text']);
        } catch (\Throwable $e) {
            Log::error('assistant_chat_ollama', ['e'=>$e->getMessage()]);
            return response()->json([
                'reply' => "Ocurrió un problema al consultar la IA. Intenta nuevamente.",
                'grounding' => $ground
            ], 500);
        }

        return response()->json([
            'reply'     => $reply,
            'grounding' => $ground,
        ], 200);
    }

    /* ==========================================================
     *            1) RESPUESTAS DIRECTAS CONTRA LA BD
     * ========================================================== */

    private function tryDirectAnswers(string $msg, array $ctx): ?array
    {
        $t = Str::of(Str::lower($msg));

        // --- ¿Convenios que vencen este mes / próximos 30 días / vencidos?
        if ($t->contains(['vencen este mes','vencen éste mes','este mes'])) {
            return $this->answerVencenEsteMes();
        }
        if ($t->contains(['próximos 30', 'proximos 30', 'en 30 días', '30 dias'])) {
            return $this->answerProximos30();
        }
        if ($t->contains(['vencidos','ya vencieron','vencido'])) {
            return $this->answerVencidos();
        }

        // --- ¿Más próximo a vencer?
        if ($t->contains(['más próximo a vencer','mas proximo a vencer','próximo a vencer','proximo a vencer'])) {
            return $this->answerMasProximo();
        }

        // --- Riesgos: “muéstrame los de riesgo ALTO|MEDIO|BAJO”
        if ($t->contains(['riesgo alto','de riesgo alto']))  return $this->answerRiesgo('ALTO');
        if ($t->contains(['riesgo medio']))                  return $this->answerRiesgo('MEDIO');
        if ($t->contains(['riesgo bajo']))                   return $this->answerRiesgo('BAJO');

        // --- Buscar por título: “buscar …”, “dame el nombre de todos…”
        if ($t->contains(['buscar convenio','buscar por título','buscar por titulo','dame el nombre de todos','listado de nombres'])) {
            return $this->answerListadoTitulos($msg);
        }

        // --- Detalle / versiones / historial / comparaciones “Convenio #ID …”
        if (preg_match('/convenio\s*#?\s*(\d+)/i', $msg, $m)) {
            $id = (int) $m[1];
            if ($t->contains(['detalle']))  return $this->answerDetalleConvenio($id);
            if ($t->contains(['versiones'])) return $this->answerVersiones($id);
            if ($t->contains(['historial'])) return $this->answerHistorialRiesgo($id);
            if ($t->contains(['comparar','comparación','comparacion'])) return $this->answerComparaciones($id);
        }

        // --- Notificaciones / alertas
        if ($t->contains(['notificaciones','alertas'])) {
            return $this->answerAlertas();
        }

        return null; // dejar que pase al modo IA+RAG
    }

    private function answerVencenEsteMes(): array
    {
        $hoy = now()->startOfMonth()->toDateString();
        $fin = now()->endOfMonth()->toDateString();

        $rows = DB::table('convenios')
            ->select('id','titulo','fecha_vencimiento','estado')
            ->whereNotNull('fecha_vencimiento')
            ->whereBetween(DB::raw('DATE(fecha_vencimiento)'), [$hoy, $fin])
            ->orderBy('fecha_vencimiento', 'asc')
            ->get();

        if ($rows->isEmpty()) {
            return ['reply'=>'No hay convenios que venzan este mes.', 'grounding'=>['type'=>'query','total'=>0]];
        }

        $txt = "Convenios que vencen este mes:\n";
        foreach ($rows as $r) {
            $txt .= "• #{$r->id} «{$r->titulo}» — vence {$r->fecha_vencimiento} ({$r->estado})\n";
        }
        return ['reply'=>$txt, 'grounding'=>['type'=>'query','total'=>count($rows)]];
    }

    private function answerProximos30(): array
    {
        $ini = now()->toDateString();
        $fin = now()->copy()->addDays(30)->toDateString();

        $rows = DB::table('convenios')
            ->select('id','titulo','fecha_vencimiento','estado')
            ->whereNotNull('fecha_vencimiento')
            ->whereBetween(DB::raw('DATE(fecha_vencimiento)'), [$ini, $fin])
            ->orderBy('fecha_vencimiento', 'asc')
            ->get();

        if ($rows->isEmpty()) {
            return ['reply'=>'No hay convenios por vencer en los próximos 30 días.', 'grounding'=>['type'=>'query','total'=>0]];
        }
        $txt = "Convenios que vencen en ≤ 30 días:\n";
        foreach ($rows as $r) {
            $txt .= "• #{$r->id} «{$r->titulo}» — {$r->fecha_vencimiento} ({$r->estado})\n";
        }
        return ['reply'=>$txt, 'grounding'=>['type'=>'query','total'=>count($rows)]];
    }

    private function answerVencidos(): array
    {
        $hoy = now()->toDateString();
        $rows = DB::table('convenios')
            ->select('id','titulo','fecha_vencimiento','estado')
            ->whereNotNull('fecha_vencimiento')
            ->whereDate('fecha_vencimiento', '<=', $hoy)
            ->orderBy('fecha_vencimiento','desc')
            ->limit(50)
            ->get();

        if ($rows->isEmpty()) return ['reply'=>'No hay convenios vencidos.', 'grounding'=>['type'=>'query','total'=>0]];

        $txt = "Convenios vencidos:\n";
        foreach ($rows as $r) $txt .= "• #{$r->id} «{$r->titulo}» — venció {$r->fecha_vencimiento} ({$r->estado})\n";
        return ['reply'=>$txt, 'grounding'=>['type'=>'query','total'=>count($rows)]];
    }

    private function answerMasProximo(): array
    {
        $hoy = now()->toDateString();
        $row = DB::table('convenios')
            ->select('id','titulo','fecha_vencimiento','estado')
            ->whereNotNull('fecha_vencimiento')
            ->whereDate('fecha_vencimiento', '>=', $hoy)
            ->orderBy('fecha_vencimiento','asc')
            ->first();

        if (!$row) return ['reply'=>'No encontré convenios con fecha de vencimiento futura.', 'grounding'=>['type'=>'query','total'=>0]];

        $txt = "El convenio más próximo a vencer es #{$row->id} «{$row->titulo}», con fecha {$row->fecha_vencimiento} (estado: {$row->estado}).";
        return ['reply'=>$txt, 'grounding'=>['type'=>'query','total'=>1]];
    }

    private function answerRiesgo(string $nivel): array
    {
        // Tomar último análisis por convenio y filtrar por nivel
        $sub = DB::table('analisis_riesgos')
            ->select('convenio_id', DB::raw('MAX(created_at) as mc'))
            ->groupBy('convenio_id');

        $rows = DB::table('analisis_riesgos as ar')
            ->joinSub($sub,'s',fn($j)=>$j->on('ar.convenio_id','=','s.convenio_id')->on('ar.created_at','=','s.mc'))
            ->join('convenios as c','c.id','=','ar.convenio_id')
            ->where('ar.risk_level', $nivel)
            ->select('ar.convenio_id as id','c.titulo','ar.score','ar.risk_level')
            ->orderByDesc('ar.score')
            ->limit(50)
            ->get();

        if ($rows->isEmpty()) return ['reply'=>"No hay convenios con riesgo {$nivel} en el último análisis.", 'grounding'=>['type'=>'query','total'=>0]];

        $txt = "Convenios con riesgo {$nivel} (último análisis):\n";
        foreach ($rows as $r) $txt .= "• #{$r->id} «{$r->titulo}» — score ".number_format($r->score*100,0)."%\n";
        return ['reply'=>$txt, 'grounding'=>['type'=>'query','total'=>count($rows)]];
    }

    private function answerListadoTitulos(string $msg): array
    {
        // si hay comillas "salud", filtrar; si no, lista acotada
        if (preg_match('/"([^"]+)"/', $msg, $m)) {
            $needle = '%'.Str::lower($m[1]).'%';
            $rows = DB::table('convenios')
                ->select('id','titulo')
                ->whereRaw('LOWER(titulo) LIKE ?', [$needle])
                ->orderBy('titulo','asc')
                ->limit(100)->get();
        } else {
            $rows = DB::table('convenios')->select('id','titulo')->orderBy('titulo','asc')->limit(100)->get();
        }

        if ($rows->isEmpty()) return ['reply'=>'No encontré convenios con ese criterio.', 'grounding'=>['type'=>'query','total'=>0]];

        $txt = "Listado de convenios:\n";
        foreach ($rows as $r) $txt .= "• #{$r->id} «{$r->titulo}»\n";
        return ['reply'=>$txt, 'grounding'=>['type'=>'query','total'=>count($rows)]];
    }

    private function answerDetalleConvenio(int $id): array
    {
        $c = DB::table('convenios')->where('id',$id)->first();
        if (!$c) return ['reply'=>"No encontré el convenio #{$id}.", 'grounding'=>['type'=>'query','total'=>0]];

        $ver = DB::table('versiones_convenio')->where('convenio_id',$id)->orderByDesc('numero_version')->limit(3)->get();
        $risk = DB::table('analisis_riesgos')->where('convenio_id',$id)->orderByDesc('created_at')->first();

        $txt  = "Convenio #{$c->id} «{$c->titulo}»\n";
        $txt .= "- Estado: {$c->estado}\n";
        if ($c->fecha_firma)       $txt .= "- Fecha de firma: {$c->fecha_firma}\n";
        if ($c->fecha_vencimiento) $txt .= "- Fecha de vencimiento: {$c->fecha_vencimiento}\n";
        if ($risk) $txt .= "- Último riesgo: {$risk->risk_level} (" . number_format($risk->score*100,0) ."%)\n";
        if ($ver->count()) {
            $txt .= "- Últimas versiones: ";
            $txt .= $ver->pluck('numero_version')->map(fn($n)=>"v{$n}")->join(', ');
            $txt .= "\n";
        }
        return ['reply'=>$txt, 'grounding'=>['type'=>'convenio','id'=>$id]];
    }

    private function answerVersiones(int $id): array
    {
        $rows = DB::table('versiones_convenio')
            ->where('convenio_id',$id)->orderByDesc('numero_version')->get();

        if ($rows->isEmpty()) return ['reply'=>"El convenio #{$id} no tiene versiones registradas.", 'grounding'=>['type'=>'query','total'=>0]];

        $txt = "Versiones del convenio #{$id}:\n";
        foreach ($rows as $v) {
            $txt .= "• v{$v->numero_version} — {$v->fecha_version} — {$v->observaciones}\n";
        }
        return ['reply'=>$txt, 'grounding'=>['type'=>'convenio','id'=>$id,'versions'=>count($rows)]];
    }

    private function answerHistorialRiesgo(int $id): array
    {
        $rows = DB::table('analisis_riesgos')->where('convenio_id',$id)
            ->orderByDesc('created_at')->limit(10)->get();

        if ($rows->isEmpty()) return ['reply'=>"No hay historial de riesgo para el convenio #{$id}.", 'grounding'=>['type'=>'query','total'=>0]];

        $txt = "Historial de riesgo — convenio #{$id}:\n";
        foreach ($rows as $r) {
            $txt .= "• {$r->created_at}: {$r->risk_level} (" . number_format($r->score*100,0) . "%, {$r->matches} hallazgos)\n";
        }
        return ['reply'=>$txt, 'grounding'=>['type'=>'convenio','id'=>$id,'items'=>count($rows)]];
    }

    private function answerComparaciones(int $id): array
    {
        $rows = DB::table('comparaciones as c')
            ->join('versiones_convenio as vb','vb.id','=','c.version_base_id')
            ->join('versiones_convenio as vc','vc.id','=','c.version_comparada_id')
            ->where('vb.convenio_id',$id)
            ->select('c.id','vb.numero_version as base','vc.numero_version as comp','c.resumen_cambios','c.created_at')
            ->orderByDesc('c.created_at')->limit(10)->get();

        if ($rows->isEmpty()) return ['reply'=>"No hay comparaciones registradas para el convenio #{$id}.", 'grounding'=>['type'=>'query','total'=>0]];

        $txt = "Comparaciones (últimas) — convenio #{$id}:\n";
        foreach ($rows as $r) {
            $txt .= "• v{$r->base} vs v{$r->comp}: {$r->resumen_cambios}\n";
        }
        return ['reply'=>$txt, 'grounding'=>['type'=>'convenio','id'=>$id,'items'=>count($rows)]];
    }

    private function answerAlertas(): array
    {
        // Reutilizamos la misma lógica que tienes en NotificationsController->alerts (resumen)
        // Aquí simplificamos: contamos “alto/medio” combinando últimos análisis y vencimientos
        $resp = app(NotificationsController::class)->alerts();
        $data = $resp->getData(true);

        $badge = (int) ($data['badge'] ?? 0);
        $high  = $data['high'] ?? [];
        $med   = $data['medium'] ?? [];

        $txt = "Alertas: {$badge} (ALTO: ".count($high).", MEDIO: ".count($med).")\n";
        if (!empty($high)) {
            $txt .= "— ALTO —\n";
            foreach (array_slice($high,0,5) as $a) {
                $txt .= "• #{$a['convenio_id']} «{$a['convenio_titulo']}»: ".implode('/', $a['motivos'])."\n";
            }
        }
        if (!empty($med)) {
            $txt .= "— MEDIO —\n";
            foreach (array_slice($med,0,5) as $a) {
                $txt .= "• #{$a['convenio_id']} «{$a['convenio_titulo']}»: ".implode('/', $a['motivos'])."\n";
            }
        }
        return ['reply'=>$txt, 'grounding'=>['type'=>'alerts','badge'=>$badge]];
    }

    /* ==========================================================
     *                       2) RAG (BD -> IA)
     * ========================================================== */

    private function buildGrounding(string $msg, array $ctx): array
    {
        // 1) Buscar convenios candidatos por título/desc
        $needle = '%'.Str::lower($msg).'%';
        $cands = DB::table('convenios')
            ->select('id','titulo','descripcion','estado','fecha_firma','fecha_vencimiento')
            ->where(function($q) use ($needle){
                $q->whereRaw('LOWER(titulo) LIKE ?', [$needle])
                  ->orWhereRaw('LOWER(descripcion) LIKE ?', [$needle]);
            })
            ->orderByDesc('updated_at')
            ->limit(8)->get();

        // 2) Para cada candidato, agregamos últimas versiones y último análisis
        $ctxLines = [];
        foreach ($cands as $c) {
            $ctxLines[] = "CONVENIO #{$c->id} «{$c->titulo}» — estado: {$c->estado}; firma: {$c->fecha_firma}; vencimiento: {$c->fecha_vencimiento}";
            $risk = DB::table('analisis_riesgos')->where('convenio_id',$c->id)->orderByDesc('created_at')->first();
            if ($risk) {
                $ctxLines[] = "  • Riesgo último: {$risk->risk_level} (".number_format($risk->score*100,0)."%), matches={$risk->matches}";
            }
            $vers = DB::table('versiones_convenio')->where('convenio_id',$c->id)->orderByDesc('numero_version')->limit(3)->get();
            if ($vers->count()) {
                $ctxLines[] = "  • Versiones: ".$vers->pluck('numero_version')->map(fn($n)=>"v{$n}")->join(', ');
            }

            // fragmentos del dataset de riesgo (sirven como “contenido”)
            $snips = DB::table('riesgo_dataset')
                ->where('convenio_id',$c->id)
                ->orderByDesc('created_at')->limit(5)->get();
            foreach ($snips as $s) {
                $ctxLines[] = "  • Fragmento: ".mb_strimwidth((string)$s->text, 0, 220, '…','UTF-8');
            }
        }

        if (empty($ctxLines)) {
            // fallback: métricas generales
            $total = DB::table('convenios')->count();
            $ctxLines[] = "No se encontraron coincidencias directas. Hay {$total} convenios en el sistema.";
        }

        return [
            'type'         => 'rag',
            'candidates'   => $cands->pluck('id')->all(),
            'context_text' => implode("\n", $ctxLines),
        ];
    }

    /* ==========================================================
     *                      3) Cliente Ollama
     * ========================================================== */

    private function askOllama(string $userMsg, string $contextText): string
    {
        $system = <<<SYS
Eres un asistente experto en gestión de convenios. Responde SIEMPRE en español, claro y conciso.
Usa EXCLUSIVAMENTE la información del contexto y lo que esté en las consultas a la base de datos.
Si no hay datos suficientes, di "No tengo esa información en el sistema" y sugiere qué dato pedir.
Formatea con viñetas cuando listes elementos. Evita prometer acciones futuras.
Contexto:
{$contextText}
SYS;

        $payload = [
            'model'    => $this->ollamaModel,
            'stream'   => false,
            'messages' => [
                ['role'=>'system', 'content'=>$system],
                ['role'=>'user',   'content'=>$userMsg],
            ],
            'options'  => [
                'temperature' => 0.2,
                'num_ctx'     => 2048,
            ],
        ];

        $client = new \GuzzleHttp\Client([
            'base_uri' => $this->ollamaUrl,
            'timeout'  => $this->ollamaTimeout,
        ]);

        $resp  = $client->post('/api/chat', ['json'=>$payload]);
        $json  = json_decode((string)$resp->getBody(), true);
        $reply = $json['message']['content'] ?? null;

        return $reply ? trim($reply) : 'No pude generar una respuesta.';
    }
}