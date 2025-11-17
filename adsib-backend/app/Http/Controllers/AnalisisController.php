<?php

namespace App\Http\Controllers;

use App\Services\RiskNlp;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Barryvdh\DomPDF\Facade\Pdf;
use Carbon\Carbon;

class AnalisisController extends Controller
{
    public function __construct(protected RiskNlp $nlp) {}

    /* ------------ Helpers de texto y filtros semánticos ------------- */

    /** Normaliza: minúsculas y sin acentos básicos */
    protected function norm(string $s): string
    {
        $s = mb_strtolower($s, 'UTF-8');
        $s = strtr($s,
            ['á'=>'a','é'=>'e','í'=>'i','ó'=>'o','ú'=>'u','ä'=>'a','ë'=>'e','ï'=>'i','ö'=>'o','ü'=>'u','ñ'=>'n']
        );
        return $s;
    }

    /** ¿token contiene alguno de los núcleos de riesgo? */
    protected function hasRiskKeyword(string $t): bool
    {
        $t = $this->norm($t);
        $KEYS = [
            'precio preferen', 'precios preferen', 'menor precio', 'menores precios',
            'exclusiv', 'trato preferen',
            'cantidad minima', 'orden minima', 'volumen minimo', 'piso minimo',
            'reemision', 'reexped',
            'presupuesto', 'aprobacion presupuestaria', 'certificacion presupuestaria',
        ];
        foreach ($KEYS as $k) {
            if (mb_strpos($t, $k) !== false) return true;
        }
        return false;
    }

    /** ¿hay negación contextual cerca del token? */
    protected function hasNegationAround(string $text, string $token): bool
    {
        $N = 80; // ventana de contexto a cada lado
        $tx = $this->norm($text);
        $tk = $this->norm($token);
        $pos = mb_strpos($tx, $tk);
        if ($pos === false) return false;
        $start = max(0, $pos - $N);
        $end   = min(mb_strlen($tx), $pos + mb_strlen($tk) + $N);
        $win   = mb_substr($tx, $start, $end - $start);

        // patrones de negación o desactivación
        $NEG = [
            'no ', ' no-', 'no implica', 'no confiere', 'no constituye', 'no se asumen',
            'sin ', 'no se admit', 'no reserv', 'no confiere trato prefer',
            'no conlleva', 'no genera', 'no oblig', 'sin exclusiv',
            'sujeto a normativa', 'sujetas? a normativa', 'conforme a normativa',
            'segun normativa', 'de acuerdo a normativa', 'no se autoriz',
        ];
        foreach ($NEG as $n) {
            if (mb_strpos($win, $n) !== false) return true;
        }
        return false;
    }

    /* ----------------- Helpers para deduplicación por solapamiento ----------------- */

    /** Normalización "estricta" de token para comparar similitud */
    protected function normToken(string $t): string
    {
        $t = $this->norm($t);
        $t = preg_replace('/\s+/', ' ', $t ?? '') ?? '';
        return trim($t);
    }

    /** IoU (intersección / unión) de dos rangos [a1,a2), [b1,b2) -> 0..1 */
    protected function iou(int $a1, int $a2, int $b1, int $b2): float
    {
        if ($a2 <= $a1 || $b2 <= $b1) return 0.0;
        $inter = max(0, min($a2, $b2) - max($a1, $b1));
        $union = max($a2, $b2) - min($a1, $b1);
        if ($union <= 0) return 0.0;
        return $inter / $union;
    }

    /**
     * Deduplica matches que:
     *  - comparten tipo de fuente (regla vs. semántico) y severidad
     *  - y su token normalizado es "similar" (exacto tras normalización)
     *  - y sus rangos con offsets se solapan con IoU >= 0.6
     * Se conserva el de mayor cobertura (rango más largo); si igual, el primero.
     */
    protected function dedupeOverlaps(array $matches): array
    {
        $kept = [];
        foreach ($matches as $m) {
            $tok = $this->normToken((string)($m['token'] ?? ''));
            $src = strtolower((string)($m['source'] ?? ''));
            $sev = strtoupper((string)($m['severity'] ?? 'NONE'));

            $hasOff = isset($m['start'], $m['end']) && is_numeric($m['start']) && is_numeric($m['end']) && ($m['end'] > $m['start']);
            if (!$hasOff || $tok === '') {
                $kept[] = $m;
                continue;
            }

            $s1 = (int)$m['start']; $e1 = (int)$m['end'];
            $merged = false;

            foreach ($kept as $idx => $prev) {
                $tok2 = $this->normToken((string)($prev['token'] ?? ''));
                $src2 = strtolower((string)($prev['source'] ?? ''));
                $sev2 = strtoupper((string)($prev['severity'] ?? 'NONE'));

                $hasOff2 = isset($prev['start'], $prev['end']) && is_numeric($prev['start']) && is_numeric($prev['end']) && ($prev['end'] > $prev['start']);
                if (!$hasOff2) continue;

                if ($src !== $src2 || $sev !== $sev2) continue;
                if ($tok !== $tok2) continue;

                $s2 = (int)$prev['start']; $e2 = (int)$prev['end'];
                $over = $this->iou($s1, $e1, $s2, $e2);

                if ($over >= 0.60) {
                    $len1 = $e1 - $s1;
                    $len2 = $e2 - $s2;
                    if ($len1 > $len2) {
                        $kept[$idx] = $m;
                    }
                    $merged = true;
                    break;
                }
            }

            if (!$merged) {
                $kept[] = $m;
            }
        }
        return array_values($kept);
    }

    /**
     * Filtra/depura coincidencias SEMANTIC y pondera el score final.
     */
    protected function filterAndScore(array $matches, string $fullText): array
    {
        $clean = [];
        foreach ($matches as $m) {
            $src = strtolower((string)($m['source'] ?? ''));
            if ($src === 'semantic') {
                $token = (string)($m['token'] ?? '');
                if (!$this->hasRiskKeyword($token)) {
                    continue;
                }
                if ($this->hasNegationAround($fullText, $token)) {
                    continue;
                }
            }
            $clean[] = $m;
        }

        $clean = $this->dedupeOverlaps($clean);

        $W_RULE = ['HIGH'=>1.00,'MEDIUM'=>0.60,'LOW'=>0.30,'NONE'=>0.00];
        $W_SEM  = ['HIGH'=>0.15,'MEDIUM'=>0.08,'LOW'=>0.03,'NONE'=>0.00];

        $CAP_SEM = 0.35;
        $DENOM   = 7.0;

        $TH_MEDIO = 0.45;
        $TH_ALTO  = 0.80;

        $sumRule = 0.0; $sumSem = 0.0;
        foreach ($clean as $m) {
            $sev = strtoupper((string)($m['severity'] ?? 'NONE'));
            $src = strtolower((string)($m['source'] ?? ''));
            if ($src === 'semantic') {
                $sumSem += $W_SEM[$sev] ?? 0.0;
            } else {
                $sumRule += $W_RULE[$sev] ?? 0.0;
            }
        }

        $sumSem = min($sumSem, $sumRule * $CAP_SEM);
        $total  = $sumRule + $sumSem;
        $score  = max(0.0, min(1.0, $DENOM > 0 ? ($total / $DENOM) : 0.0));

        $risk = ($score >= $TH_ALTO) ? 'ALTO' : (($score >= $TH_MEDIO) ? 'MEDIO' : 'BAJO');

        return [
            'kept_matches' => $clean,
            'score'        => $score,
            'risk_level'   => $risk,
            'dbg'          => [
                'sums'        => ['rule'=>$sumRule,'semantic'=>$sumSem,'total'=>$total],
                'denominator' => $DENOM,
                'cap_sem'     => $CAP_SEM,
                'thresholds'  => ['MEDIO'=>$TH_MEDIO, 'ALTO'=>$TH_ALTO],
            ],
        ];
    }

    /* ------------------------- Acción principal ------------------------- */

    public function riesgo(Request $request)
    {
        $text       = (string) ($request->input('text') ?? '');
        $convenioId = $request->input('convenio_id');
        $versionId  = $request->input('version_id');

        if (trim($text) === '') {
            return response()->json(['message' => 'El texto a analizar está vacío.'], 422);
        }

        $resp = $this->nlp->analyze($text);
        if (!($resp['ok'] ?? false)) {
            return response()->json([
                'message' => 'No se pudo procesar el análisis.',
                'detail'  => $resp['error'] ?? 'Error',
            ], 502);
        }

        $data    = $resp['data'] ?? [];
        $matches = is_array($data['matches'] ?? null) ? $data['matches'] : [];
        $modelo  = (string) ($data['summary']['model_embedder'] ?? 'tfidf-pipeline');

        $calc = $this->filterAndScore($matches, $text);

        $matchesClean = $calc['kept_matches'];
        $data['matches']    = $matchesClean;
        $data['score']      = $calc['score'];
        $data['risk_level'] = $calc['risk_level'];
        $data['summary'] = array_merge($data['summary'] ?? [], [
            'post_score' => $calc['dbg']
        ]);

        $riskLevel = (string) $data['risk_level'];
        $score     = (float)  $data['score'];

        try {
            DB::beginTransaction();

            $idAnalisis = DB::table('analisis_riesgos')->insertGetId([
                'convenio_id'  => $convenioId,
                'version_id'   => $versionId,
                'risk_level'   => $riskLevel,
                'score'        => $score,
                'matches'      => is_countable($matchesClean) ? count($matchesClean) : 0,
                'modelo'       => $modelo,
                'analizado_en' => now(),
                'created_at'   => now(),
                'updated_at'   => now(),
            ]);

            if (!empty($matchesClean)) {
                $bulk = [];
                foreach ($matchesClean as $m) {
                    $bulk[] = [
                        'convenio_id' => $convenioId,
                        'version_id'  => $versionId,
                        'page'        => $m['page']  ?? null,
                        'line'        => $m['line']  ?? null,
                        'start'       => $m['start'] ?? null,
                        'end'         => $m['end']   ?? null,
                        'text'        => $m['token'] ?? '',
                        'label_json'  => json_encode([
                            'severity' => $m['severity'] ?? null,
                            'reason'   => $m['reason']   ?? null,
                            'source'   => $m['source']   ?? null,
                        ], JSON_UNESCAPED_UNICODE),
                        'source'      => $m['source'] ?? null,
                        'created_at'  => now(),
                        'updated_at'  => now(),
                    ];
                }
                DB::table('riesgo_dataset')->insert($bulk);
            }

            if (in_array($riskLevel, ['ALTO', 'MEDIO'], true) && $convenioId) {
                $tipo    = $riskLevel === 'ALTO' ? 'ALTO_RIESGO' : 'MEDIO_RIESGO';
                $mensaje = $riskLevel === 'ALTO'
                    ? 'Riesgo ALTO detectado por el modelo. Revise cláusulas observadas.'
                    : 'Riesgo MEDIO detectado por el modelo. Requiere revisión.';
                $acciones = json_encode([
                    'detalle' => 'Abrir análisis y revisar coincidencias.',
                    'modelo'  => $modelo,
                    'score'   => $score,
                ], JSON_UNESCAPED_UNICODE);

                $exists = DB::table('notificaciones')
                    ->where('convenio_id', $convenioId)
                    ->where('tipo', $tipo)
                    ->where('leido', false)
                    ->first();

                if ($exists) {
                    DB::table('notificaciones')
                        ->where('id', $exists->id)
                        ->update([
                            'mensaje'     => $mensaje,
                            'acciones'    => $acciones,
                            'fecha_envio' => now(),
                            'updated_at'  => now(),
                        ]);
                } else {
                    DB::table('notificaciones')->insert([
                        'convenio_id' => $convenioId,
                        'tipo'        => $tipo,
                        'mensaje'     => $mensaje,
                        'acciones'    => $acciones,
                        'leido'       => false,
                        'fecha_envio' => now(),
                        'created_at'  => now(),
                        'updated_at'  => now(),
                    ]);
                }
            }

            DB::commit();

            $data['saved_id'] = $idAnalisis;
            return response()->json($data, 200);

        } catch (\Throwable $e) {
            DB::rollBack();
            return response()->json([
                'message' => 'Error guardando el análisis',
                'detail'  => $e->getMessage(),
            ], 500);
        }
    }

    // Historial (general por convenio)
    public function index(Request $request)
    {
        $convenioId = $request->query('convenio_id');
        $perPage    = (int) ($request->query('per') ?? 10);
        $page       = (int) ($request->query('page') ?? 1);

        if (!$convenioId) {
            return response()->json(['message' => 'convenio_id es requerido'], 422);
        }

        $query = DB::table('analisis_riesgos')
            ->where('convenio_id', $convenioId)
            ->orderByDesc('analizado_en');

        $total = (clone $query)->count();

        $rawItems = $query->forPage($page, $perPage)->get();
        $items = $rawItems->map(function ($r) {
            $r->analizado_en = Carbon::parse($r->analizado_en)->toIso8601String();
            $r->created_at   = Carbon::parse($r->created_at)->toIso8601String();
            $r->updated_at   = Carbon::parse($r->updated_at)->toIso8601String();
            return $r;
        });

        return response()->json([
            'data' => $items,
            'meta' => [
                'page'    => $page,
                'per'     => $perPage,
                'total'   => $total,
                'hasMore' => ($page * $perPage) < $total,
            ],
        ]);
    }

    /**
     * Exporta un análisis en PDF (descarga directa, sin abrir vista).
     */
    public function pdf(int $id)
    {
        try {
            $analysis = DB::table('analisis_riesgos')->where('id', $id)->first();

            if (!$analysis) {
                return response()->json(['message' => 'Análisis no encontrado'], 404);
            }

            $convenio = DB::table('convenios')->where('id', $analysis->convenio_id)->first();

            $tituloConvenio = $convenio->titulo ?? ('Convenio #' . $analysis->convenio_id);
            $codigo         = $analysis->id;
            $fecha          = $analysis->analizado_en
                ? Carbon::parse($analysis->analizado_en)->format('d/m/Y H:i')
                : '—';
            $nivel          = strtoupper($analysis->risk_level ?? '—');
            $confianza      = number_format(max(0, min(1, (float)$analysis->score)) * 100, 0) . '%';
            $modelo         = $analysis->modelo ?? 'Desconocido';
            $hallazgos      = $analysis->matches ?? 0;

            $safe = fn($v) => htmlspecialchars((string)$v, ENT_QUOTES, 'UTF-8');

            $html = '
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <title>Análisis de riesgo convenio ' . $safe($tituloConvenio) . '</title>
    <style>
        body { font-family: DejaVu Sans, sans-serif; font-size: 12px; color: #111827; }
        h1 { font-size: 18px; margin-bottom: 4px; }
        h2 { font-size: 14px; margin-top: 16px; margin-bottom: 6px; }
        .small { font-size: 11px; color: #4b5563; }
        .box { border: 1px solid #d1d5db; border-radius: 4px; padding: 8px; margin-top: 6px; }
        .row { display: flex; justify-content: space-between; margin-bottom: 4px; }
        .label { font-weight: bold; }
        .pill { display: inline-block; padding: 4px 8px; border-radius: 999px; font-weight: bold; }
        .pill-alto { background: #b91c1c; color: #fff; }
        .pill-medio { background: #92400e; color: #fff; }
        .pill-bajo { background: #065f46; color: #fff; }
        .pill-otro { background: #4b5563; color: #fff; }
        .mt-2 { margin-top: 8px; }
        .mt-3 { margin-top: 12px; }
        .mb-0 { margin-bottom: 0; }
        .text-right { text-align: right; }
        .muted { color: #6b7280; font-size: 11px; }
        hr { border: none; border-top: 1px solid #e5e7eb; margin: 10px 0; }
    </style>
</head>
<body>
    <h1>Análisis de riesgo del convenio</h1>
    <div class="small">Generado automáticamente por el módulo de análisis de riesgos.</div>

    <div class="box mt-2">
        <div class="row">
            <div><span class="label">Convenio:</span> ' . $safe($tituloConvenio) . '</div>
            <div class="small">ID análisis: ' . $safe($codigo) . '</div>
        </div>
        <div class="row">
            <div><span class="label">Fecha de análisis:</span> ' . $safe($fecha) . '</div>
            <div><span class="label">Modelo:</span> ' . $safe($modelo) . '</div>
        </div>
    </div>

    <h2>Resultado global</h2>
    <div class="box">
        <div class="row">
            <div>
                <span class="label">Nivel de riesgo:</span>
                ' . $this->renderRiskPill($nivel) . '
            </div>
            <div class="text-right">
                <span class="label">Confianza del modelo:</span>
                ' . $safe($confianza) . '
            </div>
        </div>
        <div class="mt-2">
            <span class="label">Hallazgos registrados:</span> ' . $safe($hallazgos) . '
        </div>
    </div>

    <h2>Notas</h2>
    <div class="box">
        <p class="mb-0">
            Este documento resume el resultado del análisis automático de riesgo sobre el texto del convenio.
            Se recomienda revisar las cláusulas señaladas en el sistema para un análisis jurídico detallado.
        </p>
    </div>

    <hr>

    <div class="muted">
        ADSIB — Sistema de Gestión de Convenios · Análisis de riesgos automatizado.
    </div>
</body>
</html>';

            $pdf = Pdf::loadHTML($html)->setPaper('A4', 'portrait');
            $fileName = 'analisis_riesgo_' . $analysis->id . '.pdf';

            return $pdf->download($fileName);

        } catch (\Throwable $e) {
            return response()->json([
                'message' => 'Error generando el PDF del análisis',
                'detail'  => $e->getMessage(),
            ], 500);
        }
    }

    /**
     * Renderiza un span con estilo según nivel de riesgo.
     */
    protected function renderRiskPill(string $nivel): string
    {
        $n = strtoupper(trim($nivel));
        $class = 'pill-otro';
        switch ($n) {
            case 'ALTO':
                $class = 'pill-alto';
                break;
            case 'MEDIO':
                $class = 'pill-medio';
                break;
            case 'BAJO':
                $class = 'pill-bajo';
                break;
        }
        $safe = htmlspecialchars($n, ENT_QUOTES, 'UTF-8');
        return '<span class="pill ' . $class . '">' . $safe . '</span>';
    }
}