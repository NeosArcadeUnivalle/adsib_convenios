<?php

namespace App\Http\Controllers;

use App\Services\RiskNlp;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

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

    /**
     * Filtra/depura coincidencias SEMANTIC y pondera el score final.
     * - Elimina anticipaciones sin palabra núcleo.
     * - Elimina anticipaciones con negación contextual.
     * - Reduce fuerte el peso de lo semántico y limita su aporte global.
     */
    protected function filterAndScore(array $matches, string $fullText): array
    {
        // 1) depurar anticipaciones
        $clean = [];
        foreach ($matches as $m) {
            $src = strtolower((string)($m['source'] ?? ''));
            if ($src === 'semantic') {
                $token = (string)($m['token'] ?? '');
                // descartar si no toca tema núcleo
                if (!$this->hasRiskKeyword($token)) {
                    continue;
                }
                // descartar si hay negación en contexto
                if ($this->hasNegationAround($fullText, $token)) {
                    continue;
                }
            }
            $clean[] = $m;
        }

        // 2) ponderación
        $W_RULE = ['HIGH'=>1.00,'MEDIUM'=>0.60,'LOW'=>0.30,'NONE'=>0.00];
        // aún más bajo que antes
        $W_SEM  = ['HIGH'=>0.15,'MEDIUM'=>0.08,'LOW'=>0.03,'NONE'=>0.00];

        $CAP_SEM = 0.35; // el aporte semántico no puede pasar del 35% del aporte por reglas
        $DENOM   = 7.0;  // endurece el score global

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
        // Validación
        $text       = (string) ($request->input('text') ?? '');
        $convenioId = $request->input('convenio_id');
        $versionId  = $request->input('version_id');

        if (trim($text) === '') {
            return response()->json(['message' => 'El texto a analizar está vacío.'], 422);
        }

        // Llamada al servicio NLP
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

        // Depurar anticipaciones y recalcular score/risk
        $calc = $this->filterAndScore($matches, $text);

        // Reemplazar matches por los depurados (lo que ves y lo que se guarda)
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

            // 1) Cabecera
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

            // 2) Dataset detalle (solo los que pasaron el filtro)
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

            // 3) Notificación
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
    
        // Traemos y convertimos fechas a ISO-8601 con zona horaria explícita
        $rawItems = $query->forPage($page, $perPage)->get();
        $items = $rawItems->map(function ($r) {
            $r->analizado_en = \Carbon\Carbon::parse($r->analizado_en)->toIso8601String();
            $r->created_at   = \Carbon\Carbon::parse($r->created_at)->toIso8601String();
            $r->updated_at   = \Carbon\Carbon::parse($r->updated_at)->toIso8601String();
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
}