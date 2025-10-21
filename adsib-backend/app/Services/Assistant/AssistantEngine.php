<?php

namespace App\Services\Assistant;

use Illuminate\Support\Str;
use Illuminate\Support\Facades\DB;

class AssistantEngine
{
    protected OllamaClient $ai;

    public function __construct(OllamaClient $ai)
    {
        $this->ai = $ai;
    }

    public function answer(string $message, array $context = []): array
    {
        $message = trim($message);
        $ctxConvenioId = $context['convenio_id'] ?? null;

        // 1) Detectar intención simple por palabras clave
        $intent = $this->detectIntent($message);

        // 2) Buscar datos en BD según intención
        $data = $this->queryData($intent, $message, $ctxConvenioId);

        // 3) Armar prompt con datos + snippets y pedir a la IA local
        $prompt = $this->buildPrompt($message, $intent, $data);

        $reply = $this->ai->generate($prompt);

        return [
            'intent' => $intent,
            'data'   => $data,
            'reply'  => $reply,
        ];
    }

    protected function detectIntent(string $q): string
    {
        $s = Str::lower($q);

        if (Str::contains($s, ['vence', 'vencen', 'vencimiento', 'próximo mes', 'este mes', '30 días'])) {
            return 'vencimientos';
        }
        if (Str::contains($s, ['riesgo alto', 'riesgo medio', 'riesgo bajo', 'riesgo'])) {
            return 'riesgo';
        }
        if (preg_match('/convenio\s*#?\s*(\d+)/i', $s)) {
            return 'detalle_por_id';
        }
        if (Str::contains($s, ['detalle', 'información', 'info', 'resumen'])) {
            return 'detalle';
        }
        if (Str::contains($s, ['buscar', 'título', 'titulo', 'palabra'])) {
            return 'buscar_titulo';
        }
        if (Str::contains($s, ['versión', 'versiones', 'comparar', 'historial', 'logs'])) {
            return 'meta_versiones';
        }

        // Si el usuario pregunta algo del contenido del documento:
        if (Str::contains($s, ['qué dice', 'que dice', 'contenido', 'artículo', 'cláusula', 'clausula', 'donde menciona', 'en qué página', 'texto'])) {
            return 'contenido';
        }

        // fallback: probar primero contenido (RAG), si no hay hits, general
        return 'contenido';
    }

    protected function queryData(string $intent, string $q, $ctxConvenioId): array
    {
        switch ($intent) {
            case 'vencimientos':
                return $this->qVencimientos($q);
            case 'riesgo':
                return $this->qRiesgos($q);
            case 'buscar_titulo':
                return $this->qBuscarTitulo($q);
            case 'detalle_por_id':
                return $this->qDetallePorId($q);
            case 'detalle':
                return $this->qDetalleMixto($q, $ctxConvenioId);
            case 'meta_versiones':
                return $this->qMetaVersiones($q);
            case 'contenido':
            default:
                return $this->qContenido($q, $ctxConvenioId);
        }
    }

    /* ====== Consultas a BD ====== */

    protected function qVencimientos(string $q): array
    {
        // rango aproximado “este mes” / “30 días”
        $desde = now()->startOfMonth()->toDateString();
        $hasta = now()->endOfMonth()->toDateString();
        if (Str::contains(Str::lower($q), ['30', 'treinta'])) {
            $desde = now()->toDateString();
            $hasta = now()->addDays(30)->toDateString();
        }

        $rows = DB::table('convenios')
            ->select('id','titulo','fecha_vencimiento')
            ->whereNotNull('fecha_vencimiento')
            ->whereBetween('fecha_vencimiento', [$desde, $hasta])
            ->orderBy('fecha_vencimiento')
            ->limit(50)
            ->get();

        return [
            'tipo' => 'vencimientos',
            'desde' => $desde,
            'hasta' => $hasta,
            'items' => $rows,
        ];
    }

    protected function qRiesgos(string $q): array
    {
        // riesgo ALTO|MEDIO|BAJO (tomar el último análisis por convenio)
        $nivel = 'ALTO';
        if (Str::contains(Str::upper($q), 'MEDIO')) $nivel = 'MEDIO';
        if (Str::contains(Str::upper($q), 'BAJO'))  $nivel = 'BAJO';

        $rows = DB::table('analisis_riesgos as a')
            ->select('a.id','a.convenio_id','a.risk_level','a.score','a.analizado_en','c.titulo')
            ->join('convenios as c','c.id','=','a.convenio_id')
            ->where('a.risk_level', $nivel)
            ->orderByDesc('a.analizado_en')
            ->limit(30)
            ->get();

        return [
            'tipo' => 'riesgo',
            'nivel' => $nivel,
            'items' => $rows,
        ];
    }

    protected function qBuscarTitulo(string $q): array
    {
        // extrae palabra(s) entre comillas o después de “buscar”
        if (preg_match('/"(.*?)"/', $q, $m)) {
            $needle = $m[1];
        } else {
            $needle = Str::of($q)->after('buscar')->after('titulo')->trim()->toString();
            if ($needle === '') $needle = Str::of($q)->after('título')->trim()->toString();
        }

        $rows = DB::table('convenios')
            ->select('id','titulo','fecha_vencimiento')
            ->where('titulo', 'ilike', '%'.$needle.'%')
            ->orderBy('titulo')
            ->limit(30)
            ->get();

        return [
            'tipo' => 'buscar_titulo',
            'query' => $needle,
            'items' => $rows,
        ];
    }

    protected function qDetallePorId(string $q): array
    {
        preg_match('/convenio\s*#?\s*(\d+)/i', $q, $m);
        $id = $m[1] ?? null;
        if (!$id) return ['tipo'=>'detalle','error'=>'No se pudo extraer el id.'];

        $convenio = DB::table('convenios')->where('id',$id)->first();

        $ultRiesgo = DB::table('analisis_riesgos')
            ->select('risk_level','score','analizado_en')
            ->where('convenio_id',$id)
            ->orderByDesc('analizado_en')
            ->first();

        $versiones = DB::table('versiones_convenio')
            ->select('id','numero_version','fecha_version')
            ->where('convenio_id',$id)
            ->orderByDesc('numero_version')
            ->limit(10)
            ->get();

        return [
            'tipo' => 'detalle',
            'convenio' => $convenio,
            'riesgo' => $ultRiesgo,
            'versiones' => $versiones,
        ];
    }

    protected function qDetalleMixto(string $q, $ctxConvenioId): array
    {
        // si hay id en contexto úsalo; si no, intenta por título rápido:
        $row = null;
        if ($ctxConvenioId) {
            $row = DB::table('convenios')->where('id',$ctxConvenioId)->first();
        } else {
            $pos = Str::of($q)->after('convenio')->trim()->toString();
            if ($pos !== '') {
                $row = DB::table('convenios')->where('titulo','ilike','%'.$pos.'%')->first();
            }
        }
        if (!$row) return ['tipo'=>'detalle','error'=>'No encontré el convenio indicado.'];

        return $this->qDetallePorId("convenio #{$row->id}");
    }

    protected function qMetaVersiones(string $q): array
    {
        // si el usuario escribe "convenio #12 versiones|comparar|historial|logs"
        preg_match('/convenio\s*#?\s*(\d+)/i', $q, $m);
        $id = $m[1] ?? null;
        if (!$id) return ['tipo'=>'meta_versiones','error'=>'No se pudo extraer el id.'];

        $versiones = DB::table('versiones_convenio')
            ->select('id','numero_version','fecha_version','observaciones')
            ->where('convenio_id',$id)
            ->orderByDesc('numero_version')
            ->get();

        $logs = DB::table('logs_documentales')
            ->select('accion','descripcion','fecha')
            ->where('convenio_id',$id)
            ->orderByDesc('fecha')
            ->limit(50)
            ->get();

        return [
            'tipo' => 'meta_versiones',
            'convenio_id' => $id,
            'versiones' => $versiones,
            'logs' => $logs,
        ];
    }

    protected function qContenido(string $q, $ctxConvenioId): array
    {
        // RAG sobre riesgo_dataset (no requiere extensiones)
        // si hay convenio en contexto, se filtra; si no, busca global
        $builder = DB::table('riesgo_dataset')
            ->select('convenio_id','version_id','page','line','text')
            ->whereNotNull('text');

        if ($ctxConvenioId) {
            $builder->where('convenio_id', $ctxConvenioId);
        }

        // Usar full-text “español” básico
        $qts = trim($q);
        $rows = $builder
            ->whereRaw("to_tsvector('spanish', text) @@ plainto_tsquery('spanish', ?)", [$qts])
            ->orderByRaw("ts_rank(to_tsvector('spanish', text), plainto_tsquery('spanish', ?)) DESC", [$qts])
            ->limit(12)
            ->get();

        return [
            'tipo'     => 'contenido',
            'query'    => $q,
            'snippets' => $rows,
        ];
    }

    /* ====== Prompt ====== */

    protected function buildPrompt(string $question, string $intent, array $data): string
    {
        $ctx = '';

        switch ($intent) {
            case 'vencimientos':
                $ctx .= "Vencimientos entre {$data['desde']} y {$data['hasta']}:\n";
                foreach ($data['items'] as $r) {
                    $ctx .= "- #{$r->id} {$r->titulo} (vence {$r->fecha_vencimiento})\n";
                }
                break;

            case 'riesgo':
                $ctx .= "Convenios con riesgo {$data['nivel']} (recientes):\n";
                foreach ($data['items'] as $r) {
                    $conf = number_format(($r->score ?? 0) * 100, 0)."%";
                    $ctx .= "- #{$r->convenio_id} {$r->titulo} • confianza {$conf} • analizado {$r->analizado_en}\n";
                }
                break;

            case 'buscar_titulo':
                $ctx .= "Resultados por título que contiene «{$data['query']}»:\n";
                foreach ($data['items'] as $r) {
                    $ven = $r->fecha_vencimiento ?? 'N/D';
                    $ctx .= "- #{$r->id} {$r->titulo} (vencimiento: {$ven})\n";
                }
                break;

            case 'detalle':
                if (!empty($data['error'])) {
                    $ctx .= "Error: {$data['error']}\n";
                } else {
                    $c = $data['convenio'];
                    $ctx .= "Convenio #{$c->id} «{$c->titulo}»\n";
                    $ctx .= "Vence: ".($c->fecha_vencimiento ?? 'N/D')."\n";
                    if ($data['riesgo']) {
                        $ctx .= "Último riesgo: {$data['riesgo']->risk_level} (".number_format(($data['riesgo']->score ?? 0)*100,0)."%) el {$data['riesgo']->analizado_en}\n";
                    }
                    $ctx .= "Versiones:\n";
                    foreach ($data['versiones'] as $v) {
                        $ctx .= "- v{$v->numero_version} (id {$v->id}) {$v->fecha_version}\n";
                    }
                }
                break;

            case 'meta_versiones':
                if (!empty($data['error'])) {
                    $ctx .= "Error: {$data['error']}\n";
                } else {
                    $ctx .= "Convenio #{$data['convenio_id']} versiones y logs:\n";
                    foreach ($data['versiones'] as $v) {
                        $ctx .= "- v{$v->numero_version} (id {$v->id}) {$v->fecha_version}\n";
                    }
                    $ctx .= "Logs recientes:\n";
                    foreach ($data['logs'] as $L) {
                        $ctx .= "- {$L->fecha}: {$L->accion} — {$L->descripcion}\n";
                    }
                }
                break;

            case 'contenido':
            default:
                $ctx .= "Fragmentos relevantes del corpus (convenio/version/página/línea):\n";
                foreach ($data['snippets'] ?? [] as $s) {
                    $line = $s->line ?? '?';
                    $page = $s->page ?? '?';
                    $texto = trim(preg_replace('/\s+/', ' ', $s->text ?? ''));
                    $ctx .= "- C{$s->convenio_id} V{$s->version_id} P{$page} L{$line}: {$texto}\n";
                }
        }

        $instrucciones = <<<EOT
Eres un asistente de convenios. Contesta en español, claro y amable. 
Si el usuario pide localización, indica página y línea si están disponibles.
Si no hay datos suficientes, dilo y ofrece opciones concretas (p.ej. buscar por título, ver versiones, comparar).
Nunca inventes datos: usa SOLO el contexto provisto.

Pregunta del usuario:
{$question}

Contexto:
{$ctx}

Responde de forma conversacional y, si corresponde, lista los convenios/fragmentos en bullets.
EOT;

        return $instrucciones;
    }
}