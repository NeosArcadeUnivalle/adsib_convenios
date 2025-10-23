<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

class AssistantController extends Controller
{
    private string $ollamaUrl;
    private string $ollamaModel;
    private int    $ollamaTimeout;
    private ?string $semanticBase;

    public function __construct()
    {
        $this->ollamaUrl     = rtrim(env('OLLAMA_URL', 'http://127.0.0.1:11434'), '/');
        $this->ollamaModel   = env('OLLAMA_MODEL', 'llama3.2:3b');
        $this->ollamaTimeout = (int) env('OLLAMA_TIMEOUT', 45);
        $this->semanticBase  = rtrim(env('SEMANTIC_BASE', 'http://127.0.0.1:8010'), '/');
    }

    /* =========================================================
     *  POST /api/assistant/chat  { message, context? }
     * =======================================================*/
    public function chat(Request $r)
    {
        $msg     = trim((string)($r->input('message') ?? ''));
        $context = (array) ($r->input('context') ?? []);

        if ($msg === '') {
            return response()->json([
                'reply' => 'Escribe tu consulta…',
                'grounding' => ['type' => 'none']
            ]);
        }

        if ($direct = $this->tryDirectAnswers($msg, $context)) {
            return response()->json($direct, 200, [], JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
        }

        $ground = $this->buildGrounding($msg);

        try {
            $reply = $this->askOllama($msg, $ground['context_text']);
            return response()->json(['reply' => $reply, 'grounding' => $ground], 200, [], JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
        } catch (\Throwable $e) {
            Log::error('assistant_ollama_error', ['e' => $e->getMessage()]);
            return response()->json([
                'reply' => 'Ocurrió un problema al consultar la IA. Intenta nuevamente.',
                'grounding' => $ground
            ], 500);
        }
    }

    /* =================== INTENTS DIRECTOS =================== */

    private function tryDirectAnswers(string $msg, array $ctx): ?array
    {
        $t = Str::lower($msg);

        // --- Contenido de versión (nuevo + ampliado)
        if ($this->isAskVersionContent($msg)) {
            return $this->answerContenidoVersion($msg);
        }

        // --- Contenido del convenio SIN versión explícita (usa la última)
        if ($this->isAskConvenioContent($msg)) {
            return $this->answerContenidoConvenioUltimaVersion($msg);
        }

        // Listados y ordenamientos
        if (preg_match('/\b(listado|lista|todos)\b.*\bconvenios\b/u', $t)) {
            return $this->answerListadoConvenios();
        }
        if (preg_match('/\bconvenios\b.*\b(orden|ordenados)\b.*\b(vencim|vencimiento)\b/u', $t)) {
            return $this->answerOrdenPorVencimiento();
        }
        if (preg_match('/\bconvenios\b.*\b(orden|ordenados)\b.*\b(firma)\b/u', $t)) {
            return $this->answerOrdenPorFirma();
        }
        if (preg_match('/\bconvenios\b.*\bestado\b.*\b(cerrado|negociacion|borrador|vencido)\b/u', $t, $m)) {
            return $this->answerPorEstado(Str::upper($m[1]));
        }
        if (preg_match('/\b(próximos|proximos)\b.*\b(vencer|vencen)\b.*\b(\d+)\b/u', $t, $m)) {
            return $this->answerProximosNDias((int)$m[2]);
        }
        if (preg_match('/\b(m[aá]s\s+pr[oó]ximo)\b.*\b(vencer|vencimiento)\b/u', $t)) {
            return $this->answerMasProximo();
        }

        // riesgos
        if (preg_match('/\briesgo\s+(alto|medio|bajo)\b/u', $t, $m)) {
            return $this->answerRiesgo(Str::upper($m[1]));
        }

        // detalles por convenio (título o "con mi convenio con X")
        if (preg_match('/\b(detalle|detalles|info|informaci[oó]n)\b.*\bconvenio\b/u', $t)) {
            if ($name = $this->parseConvenioName($msg)) {
                return $this->answerDetalleConvenioPorTitulo($name);
            }
        }

        // versiones por convenio
        if (preg_match('/\bversion(es)?\b.*\bconvenio\b/u', $t)) {
            if ($name = $this->parseConvenioName($msg)) {
                return $this->answerVersionesPorTitulo($name);
            }
        }

        // notificaciones (corregido: columnas opcionales)
        if (preg_match('/\bnotificaci[oó]n(es)?\b|\balertas?\b/u', $t)) {
            return $this->answerNotificaciones();
        }

        return null;
    }

    /* -------------------- helpers intents ------------------- */

    private function parseConvenioName(string $msg): ?string
    {
        if (preg_match('/["“”\'‘’]([^"“”\'‘’]+)["“”\'‘’]/u', $msg, $m)) {
            return trim($m[1]);
        }
        if (preg_match('/convenio\s+con\s+([^\.\n,]+?)(?=\s+(versi[oó]n|v\s*\d+|archivo|$))/iu', $msg, $m)) {
            return trim($m[1]);
        }
        if (preg_match('/del?\s+convenio\s+([^\.\n,]+?)(?=\s+(versi[oó]n|v\s*\d+|archivo|$))/iu', $msg, $m)) {
            return trim($m[1]);
        }
        return null;
    }

    private function isAskVersionContent(string $msg): bool
    {
        $t = Str::lower($msg);

        $verbs = '(contenido|contiene|que\s+dice|de\s+qu[eé]\s+(habla|trata)|habla|h[aá]blame|hablame|analiza|an[aá]lisis|explica|resume|resumen|detalla|cl[aá]usulas?|obligaciones?|pagos?|confidencialidad)';
        $ver  = '(versi[oó]n\s*\d+|\bv\s*\d+\b|\b(inicial|final)\b|archivo\s+(inicial|final))';

        return (bool) (preg_match("/{$verbs}/u", $t) && preg_match("/{$ver}/u", $t));
    }

    private function isAskConvenioContent(string $msg): bool
    {
        $t = Str::lower($msg);
        $verbs = '(contenido|contiene|que\s+dice|de\s+qu[eé]\s+(habla|trata)|habla|analiza|an[aá]lisis|explica|resume|resumen|cl[aá]usulas?|obligaciones?|pagos?|confidencialidad)';
        return (bool) (preg_match("/{$verbs}/u", $t) && preg_match('/\bconvenio\b/u', $t));
    }

    private function parseVersionHint(string $msg): array
    {
        $t = Str::lower($msg);
        if (preg_match('/\bv\s*(\d+)\b/u', $t, $m)) return ['type'=>'num','num'=>(int)$m[1]];
        if (preg_match('/versi(?:ón|on)\s*(\d+)/u', $t, $m)) return ['type'=>'num','num'=>(int)$m[1]];
        if (preg_match('/\barchivo\s+inicial\b/u', $t)) return ['type'=>'inicial'];
        if (preg_match('/\barchivo\s+final\b/u', $t))   return ['type'=>'final'];
        if (preg_match('/\binicial\b/u', $t))           return ['type'=>'inicial'];
        if (preg_match('/\bfinal\b/u', $t))             return ['type'=>'final'];
        return ['type'=>'unknown'];
    }

    /* ----------------- respuestas de BD --------------------- */

    private function answerListadoConvenios(): array
    {
        $rows = DB::table('convenios')
            ->select('id','titulo','estado','fecha_firma','fecha_vencimiento')
            ->orderBy('titulo')->get();

        if ($rows->isEmpty()) return ['reply'=>'No hay convenios registrados.','grounding'=>['type'=>'query','total'=>0]];

        $fmt = fn($d)=>$d ? \Carbon\Carbon::parse($d)->locale('es')->isoFormat('D [de] MMMM [de] YYYY') : '—';
        $txt = "Listado de convenios (alfabético):\n";
        foreach ($rows as $r) {
            $txt .= "• {$r->titulo}\n  - Estado: {$r->estado}\n  - Fecha Firma: ".$fmt($r->fecha_firma)."\n  - Fecha Vencimiento: ".$fmt($r->fecha_vencimiento)."\n";
        }
        return ['reply'=>$txt,'grounding'=>['type'=>'query','total'=>count($rows)]];
    }

    private function answerOrdenPorVencimiento(): array
    {
        $rows = DB::table('convenios')->select('titulo','estado','fecha_firma','fecha_vencimiento')
            ->orderBy('fecha_vencimiento')->get();
        if ($rows->isEmpty()) return ['reply'=>'No hay datos.','grounding'=>['type'=>'query','total'=>0]];

        $fmt = fn($d)=>$d ? \Carbon\Carbon::parse($d)->locale('es')->isoFormat('D [de] MMMM [de] YYYY') : '—';
        $txt = "Convenios ordenados por fecha de vencimiento (ascendente):\n";
        foreach ($rows as $r) {
            $txt .= "• {$r->titulo}\n  - Estado: {$r->estado}\n  - Fecha Firma: ".$fmt($r->fecha_firma)."\n  - Fecha Vencimiento: ".$fmt($r->fecha_vencimiento)."\n";
        }
        return ['reply'=>$txt,'grounding'=>['type'=>'query','total'=>count($rows)]];
    }

    private function answerOrdenPorFirma(): array
    {
        $rows = DB::table('convenios')->select('titulo','estado','fecha_firma','fecha_vencimiento')
            ->orderBy('fecha_firma')->get();
        if ($rows->isEmpty()) return ['reply'=>'No hay datos.','grounding'=>['type'=>'query','total'=>0]];

        $fmt = fn($d)=>$d ? \Carbon\Carbon::parse($d)->locale('es')->isoFormat('D [de] MMMM [de] YYYY') : '—';
        $txt = "Convenios ordenados por fecha de firma (ascendente):\n";
        foreach ($rows as $r) {
            $txt .= "• {$r->titulo}\n  - Estado: {$r->estado}\n  - Fecha Firma: ".$fmt($r->fecha_firma)."\n  - Fecha Vencimiento: ".$fmt($r->fecha_vencimiento)."\n";
        }
        return ['reply'=>$txt,'grounding'=>['type'=>'query','total'=>count($rows)]];
    }

    private function answerPorEstado(string $estado): array
    {
        $rows = DB::table('convenios')->select('titulo','fecha_vencimiento','estado')
            ->where('estado',$estado)->orderBy('titulo')->get();
        if ($rows->isEmpty()) return ['reply'=>"No hay convenios en estado {$estado}.",'grounding'=>['type'=>'query','total'=>0]];

        $fmt = fn($d)=>$d ? \Carbon\Carbon::parse($d)->locale('es')->isoFormat('D [de] MMMM [de] YYYY') : '—';
        $txt = "Convenios en estado {$estado}:\n";
        foreach ($rows as $r) $txt .= "• {$r->titulo} — Vence: ".$fmt($r->fecha_vencimiento)."\n";
        return ['reply'=>$txt,'grounding'=>['type'=>'query','total'=>count($rows)]];
    }

    private function answerProximosNDias(int $dias): array
    {
        $ini = now()->toDateString();
        $fin = now()->copy()->addDays($dias)->toDateString();
        $rows = DB::table('convenios')->select('titulo','estado','fecha_vencimiento')
            ->whereBetween(DB::raw('DATE(fecha_vencimiento)'), [$ini,$fin])
            ->orderBy('fecha_vencimiento')->get();
        if ($rows->isEmpty()) return ['reply'=>"No hay convenios por vencer en ≤ {$dias} días.",'grounding'=>['type'=>'query','total'=>0]];

        $fmt = fn($d)=>\Carbon\Carbon::parse($d)->locale('es')->isoFormat('D [de] MMMM [de] YYYY');
        $txt = "Convenios que vencen en ≤ {$dias} días:\n";
        foreach ($rows as $r) $txt .= "• {$r->titulo} — ".$fmt($r->fecha_vencimiento)." ({$r->estado})\n";
        return ['reply'=>$txt,'grounding'=>['type'=>'query','total'=>count($rows)]];
    }

    private function answerMasProximo(): array
    {
        $hoy = now()->toDateString();
        $r = DB::table('convenios')->select('titulo','estado','fecha_vencimiento')
            ->whereDate('fecha_vencimiento','>=',$hoy)->orderBy('fecha_vencimiento')->first();
        if (!$r) return ['reply'=>'No encontré convenios con vencimiento futuro.','grounding'=>['type'=>'query','total'=>0]];

        $fmt = fn($d)=>\Carbon\Carbon::parse($d)->locale('es')->isoFormat('D [de] MMMM [de] YYYY');
        return ['reply'=>"El convenio más próximo a vencer es **{$r->titulo}** — {$fmt($r->fecha_vencimiento)} ({$r->estado}).",'grounding'=>['type'=>'query','total'=>1]];
    }

    private function answerRiesgo(string $nivel): array
    {
        $sub = DB::table('analisis_riesgos')->select('convenio_id', DB::raw('MAX(created_at) mc'))->groupBy('convenio_id');
        $rows = DB::table('analisis_riesgos as ar')
            ->joinSub($sub,'s',fn($j)=>$j->on('ar.convenio_id','=','s.convenio_id')->on('ar.created_at','=','s.mc'))
            ->join('convenios as c','c.id','=','ar.convenio_id')
            ->where('ar.risk_level',$nivel)
            ->select('c.titulo','ar.score','c.fecha_vencimiento')
            ->orderByDesc('ar.score')->get();

        if ($rows->isEmpty()) return ['reply'=>"No hay convenios con riesgo **{$nivel}** en el último análisis.",'grounding'=>['type'=>'query','total'=>0]];

        $fmt = fn($d)=>$d ? \Carbon\Carbon::parse($d)->locale('es')->isoFormat('D [de] MMMM [de] YYYY') : '—';
        $txt = "Convenios con riesgo **{$nivel}** (último análisis):\n";
        foreach ($rows as $r) $txt .= "• {$r->titulo} — Score: ".number_format($r->score*100,0)."% — Vence: ".$fmt($r->fecha_vencimiento)."\n";
        return ['reply'=>$txt,'grounding'=>['type'=>'query','total'=>count($rows)]];
    }

    private function answerDetalleConvenioPorTitulo(string $needle): array
    {
        $c = DB::table('convenios')->whereRaw('LOWER(titulo) LIKE ?', ['%'.Str::lower($needle).'%'])->first();
        if (!$c) return ['reply'=>"No encontré un convenio cuyo título se parezca a «{$needle}».",'grounding'=>['type'=>'query','total'=>0]];

        $vers = DB::table('versiones_convenio')->where('convenio_id',$c->id)->orderByDesc('numero_version')->limit(10)->get();
        $risk = DB::table('analisis_riesgos')->where('convenio_id',$c->id)->orderByDesc('created_at')->first();

        $fmt = fn($d)=>$d ? \Carbon\Carbon::parse($d)->locale('es')->isoFormat('D [de] MMMM [de] YYYY') : '—';
        $txt = "Detalles del convenio **{$c->titulo}**\n- Estado: {$c->estado}\n- Fecha de Firma: ".$fmt($c->fecha_firma)."\n- Fecha de Vencimiento: ".$fmt($c->fecha_vencimiento)."\n";
        if ($risk) $txt .= "- Riesgo más reciente: {$risk->risk_level} (score ".number_format($risk->score,3).")\n";
        if ($vers->count()) {
            $txt .= "- Versiones (máx. 10):\n";
            foreach ($vers as $v) {
                $txt .= "  • v{$v->numero_version} (".$fmt($v->fecha_version).") — {$v->observaciones}\n";
            }
        }
        return ['reply'=>$txt,'grounding'=>['type'=>'convenio','id'=>$c->id]];
    }

    private function answerVersionesPorTitulo(string $needle): array
    {
        $c = DB::table('convenios')->whereRaw('LOWER(titulo) LIKE ?', ['%'.Str::lower($needle).'%'])->first();
        if (!$c) return ['reply'=>"No encontré un convenio cuyo título se parezca a «{$needle}».",'grounding'=>['type'=>'query','total'=>0]];

        $rows = DB::table('versiones_convenio')->where('convenio_id',$c->id)->orderByDesc('numero_version')->get();
        if ($rows->isEmpty()) return ['reply'=>"El convenio **{$c->titulo}** no tiene versiones registradas.",'grounding'=>['type'=>'convenio','id'=>$c->id]];

        $fmt = fn($d)=>$d ? \Carbon\Carbon::parse($d)->locale('es')->isoFormat('D [de] MMMM [de] YYYY') : '—';
        $txt = "Versiones del convenio **{$c->titulo}**:\n";
        foreach ($rows as $v) $txt .= "• v{$v->numero_version} (".$fmt($v->fecha_version).") — {$v->observaciones}\n";
        return ['reply'=>$txt,'grounding'=>['type'=>'convenio','id'=>$c->id,'versions'=>count($rows)]];
    }

    private function answerNotificaciones(): array
    {
        $schema = DB::getSchemaBuilder();
        $hasEstado   = $schema->hasColumn('notifications','estado');
        $hasMensaje  = $schema->hasColumn('notifications','mensaje');
        $hasTipo     = $schema->hasColumn('notifications','tipo');
        $hasConvenio = $schema->hasColumn('notifications','convenio_id');

        $sel = ['id','created_at'];
        if ($hasTipo)     $sel[] = 'tipo';
        if ($hasEstado)   $sel[] = 'estado';
        if ($hasConvenio) $sel[] = 'convenio_id';
        if ($hasMensaje)  $sel[] = 'mensaje';

        $rows = DB::table('notifications')->select($sel)->orderByDesc('created_at')->limit(50)->get();

        if ($rows->isEmpty()) return ['reply'=>"No hay notificaciones.","grounding"=>['type'=>'query','total'=>0]];

        $fmt = fn($d)=>\Carbon\Carbon::parse($d)->locale('es')->isoFormat('D [de] MMMM [de] YYYY');
        $txt = "Notificaciones (máx. 50):\n";
        foreach ($rows as $r) {
            $tipo  = $r->tipo     ?? 'EVENTO';
            $est   = $r->estado   ?? '—';
            $conv  = $r->convenio_id ?? '—';
            $msg   = $r->mensaje  ?? '';
            $txt .= "• ".$fmt($r->created_at)." — {$tipo}".($est!=='—'?" — {$est}":"").($conv!=='—'?" — Convenio: {$conv}":"")."\n";
            if ($msg) $txt .= "  {$msg}\n";
        }
        return ['reply'=>$txt,'grounding'=>['type'=>'notifications','total'=>count($rows)]];
    }

    /* ----------- Contenido de versión (con /qa) ------------ */

    private function answerContenidoVersion(string $msg): array
    {
        $hint = $this->parseVersionHint($msg);

        // convenio
        $name = $this->parseConvenioName($msg);
        if (!$name) {
            $only = DB::table('convenios')->select('id','titulo')->orderByDesc('updated_at')->limit(2)->get();
            if ($only->count() === 1) {
                $c = (object)['id'=>$only[0]->id,'titulo'=>$only[0]->titulo];
            } else {
                return ['reply'=>"Necesito el nombre del convenio. Ej.: «háblame del contenido de la versión inicial de mi convenio con BoA».",'grounding'=>['type'=>'ask']];
            }
        } else {
            $c = DB::table('convenios')->select('id','titulo')->whereRaw('LOWER(titulo) LIKE ?', ['%'.Str::lower($name).'%'])->first();
            if (!$c) return ['reply'=>"No encontré un convenio cuyo título se parezca a «{$name}».",'grounding'=>['type'=>'query','total'=>0]];
        }

        // versión
        $q = DB::table('versiones_convenio')->where('convenio_id',$c->id);
        if ($hint['type']==='num')        $v = $q->where('numero_version',$hint['num'])->first();
        elseif ($hint['type']==='inicial')$v = $q->orderBy('numero_version')->first();
        elseif ($hint['type']==='final')  $v = (clone $q)->whereRaw('LOWER(observaciones) LIKE ?',['%final%'])->orderByDesc('fecha_version')->first() ?: $q->orderByDesc('numero_version')->first();
        else                               $v = $q->orderByDesc('numero_version')->first();

        if (!$v) return ['reply'=>"No encontré versiones para **{$c->titulo}**.",'grounding'=>['type'=>'convenio','id'=>$c->id]];

        $texto = (string)($v->texto ?? '');
        if (trim($texto) === '') {
            return ['reply'=>"La versión v{$v->numero_version} de **{$c->titulo}** no tiene texto almacenado. Sube un PDF/DOCX legible para habilitar el análisis.",'grounding'=>['type'=>'version','convenio_id'=>$c->id,'version_id'=>$v->id]];
        }

        // Microservicio
        try {
            if ($this->semanticBase) {
                $client = new \GuzzleHttp\Client(['base_uri'=>$this->semanticBase,'timeout'=>15]);
                $payload = [
                    'question' => $msg,
                    'items' => [[
                        'convenio_id' => (int)$c->id,
                        'version_id'  => (int)$v->id,
                        'fragmento'   => mb_substr($texto,0,50000,'UTF-8'),
                        'tag'         => "v{$v->numero_version}"
                    ]]
                ];
                $res = $client->post('/qa', ['json'=>$payload]);
                $json = json_decode((string)$res->getBody(), true);
                if (!empty($json['answer'])) {
                    $ans = trim($json['answer']);
                    return ['reply'=>"**{$c->titulo} — v{$v->numero_version}**\n{$ans}", 'grounding'=>['type'=>'version','convenio_id'=>$c->id,'version_id'=>$v->id,'numero'=>$v->numero_version]];
                }
            }
        } catch (\Throwable $e) {
            // fallback
        }

        // Snippet local
        $plain   = preg_replace("/\s+/", " ", strip_tags($texto));
        $snippet = mb_substr($plain, 0, 900, 'UTF-8');
        if (mb_strlen($plain,'UTF-8') > 900) $snippet .= " …";
        $reply = "Contenido de **{$c->titulo}** — v{$v->numero_version} ({$v->observaciones}):\n{$snippet}";
        return ['reply'=>$reply,'grounding'=>['type'=>'version','convenio_id'=>$c->id,'version_id'=>$v->id,'numero'=>$v->numero_version]];
    }

    /* --- Contenido del convenio (sin versión => última) ---- */

    private function answerContenidoConvenioUltimaVersion(string $msg): array
    {
        $name = $this->parseConvenioName($msg);
        if (!$name) {
            $only = DB::table('convenios')->select('id','titulo')->orderByDesc('updated_at')->limit(2)->get();
            if ($only->count() === 1) {
                $c = (object)['id'=>$only[0]->id,'titulo'=>$only[0]->titulo];
            } else {
                return ['reply'=>"¿De qué convenio hablamos? Ej.: «analiza el contenido de mi convenio con BoA».",'grounding'=>['type'=>'ask']];
            }
        } else {
            $c = DB::table('convenios')->select('id','titulo')->whereRaw('LOWER(titulo) LIKE ?', ['%'.Str::lower($name).'%'])->first();
            if (!$c) return ['reply'=>"No encontré un convenio cuyo título se parezca a «{$name}».",'grounding'=>['type'=>'query','total'=>0]];
        }

        $v = DB::table('versiones_convenio')->where('convenio_id',$c->id)->orderByDesc('numero_version')->first();
        if (!$v) return ['reply'=>"El convenio **{$c->titulo}** aún no tiene versiones.","grounding"=>['type'=>'convenio','id'=>$c->id]];

        $msg2 = $msg.' (considera la última versión)';
        return $this->answerContenidoVersion("{$msg2} versión {$v->numero_version} del convenio {$c->titulo}");
    }

    /* ------------------- RAG + OLLAMA ---------------------- */

    private function buildGrounding(string $msg): array
    {
        $needle = '%'.Str::lower($msg).'%';
        $cands = DB::table('convenios')
            ->select('id','titulo','descripcion','estado','fecha_firma','fecha_vencimiento')
            ->where(function($q) use ($needle){
                $q->whereRaw('LOWER(titulo) LIKE ?',[$needle])
                  ->orWhereRaw('LOWER(descripcion) LIKE ?',[$needle]);
            })
            ->orderByDesc('updated_at')->limit(5)->get();

        $ctxLines = [];
        foreach ($cands as $c) {
            $ctxLines[] = "CONVENIO #{$c->id} «{$c->titulo}» — estado: {$c->estado}; firma: {$c->fecha_firma}; vencimiento: {$c->fecha_vencimiento}";
            $vers = DB::table('versiones_convenio')->where('convenio_id',$c->id)->orderByDesc('numero_version')->limit(2)->get();
            foreach ($vers as $v) {
                $ctxLines[] = "  • v{$v->numero_version} — {$v->observaciones}";
                if (!empty($v->texto)) {
                    $ctxLines[] = "    Texto: ".mb_strimwidth(strip_tags((string)$v->texto), 0, 240, '…','UTF-8');
                }
            }
        }
        if (empty($ctxLines)) $ctxLines[] = "No hay coincidencias directas.";

        return [
            'type' => 'rag',
            'context_text' => implode("\n", $ctxLines),
            'candidates' => $cands->pluck('id')->all(),
        ];
    }

    private function askOllama(string $userMsg, string $contextText): string
    {
        $system = <<<SYS
Eres un asistente experto en gestión de convenios. Responde SIEMPRE en español, claro y conciso.
Usa EXCLUSIVAMENTE la información del contexto y lo que esté en las consultas a la base de datos.
Si no hay datos suficientes, di: "No tengo esa información en el sistema" y sugiere qué dato pedir.
Formatea con viñetas cuando listes elementos. Evita prometer acciones futuras.
Contexto:
{$contextText}
SYS;

        $payload = [
            'model'    => $this->ollamaModel,
            'stream'   => false,
            'messages' => [
                ['role'=>'system','content'=>$system],
                ['role'=>'user','content'=>$userMsg],
            ],
            'options'  => [
                'temperature'=>0.2,
                'num_ctx'=>2048,
            ],
        ];

        $client = new \GuzzleHttp\Client(['base_uri'=>$this->ollamaUrl,'timeout'=>$this->ollamaTimeout]);
        $resp   = $client->post('/api/chat', ['json'=>$payload]);
        $json   = json_decode((string)$resp->getBody(), true);
        $reply  = $json['message']['content'] ?? null;
        return $reply ? trim($reply) : 'No pude generar una respuesta.';
    }
}