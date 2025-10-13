<?php
 
namespace App\Http\Controllers;
 
use App\Services\RiskNlp;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
 
class AnalisisController extends Controller
{
    public function __construct(protected RiskNlp $nlp) {}
 
    public function riesgo(Request $request)
    {
        // -------- Validación ligera ----------
        $text       = (string) ($request->input('text') ?? '');
        $convenioId = $request->input('convenio_id');
        $versionId  = $request->input('version_id');
 
        if (trim($text) === '') {
            return response()->json(['message' => 'El texto a analizar está vacío.'], 422);
        }
 
        // -------- Llamada al servicio NLP ----------
        $resp = $this->nlp->analyze($text);
        if (!($resp['ok'] ?? false)) {
            return response()->json([
                'message' => 'No se pudo procesar el análisis.',
                'detail'  => $resp['error'] ?? 'Error',
            ], 502);
        }
 
        $data      = $resp['data'] ?? [];
        $riskLevel = (string) ($data['risk_level'] ?? 'BAJO');           // ALTO | MEDIO | BAJO
        $score     = (float)  ($data['score'] ?? 0);
        $matches   = $data['matches'] ?? [];
        $modelo    = (string) ($data['summary']['model_embedder'] ?? 'tfidf-pipeline');
 
        try {
            DB::beginTransaction();
 
            // -------- 1) Guardar cabecera (analisis_riesgos) ----------
            $idAnalisis = DB::table('analisis_riesgos')->insertGetId([
                'convenio_id'  => $convenioId,
                'version_id'   => $versionId,
                'risk_level'   => $riskLevel,
                'score'        => $score,
                'matches'      => is_countable($matches) ? count($matches) : 0,
                'modelo'       => $modelo,
                'analizado_en' => now(),
                'created_at'   => now(),
                'updated_at'   => now(),
            ]);
 
            // -------- 2) Guardar dataset (riesgo_dataset) ----------
            if (is_array($matches) && count($matches)) {
                $bulk = [];
                foreach ($matches as $m) {
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
                if (!empty($bulk)) {
                    DB::table('riesgo_dataset')->insert($bulk);
                }
            }
 
            // -------- 3) Crear/actualizar notificación (ALTO/MEDIO) ----------
            // tipos: ALTO_RIESGO | MEDIO_RIESGO
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
 
                // Si hay una notificación no leída de ese tipo, actualiza; si no, crea una nueva
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
                            'updated_at'  => now(),   // <- OJO: columna correcta
                        ]);
                } else {
                    DB::table('notificaciones')->insert([
                        'convenio_id' => $convenioId,
                        'tipo'        => $tipo,
                        'mensaje'     => $mensaje,
                        'acciones'    => $acciones,
                        'leido'       => false,     // PostgreSQL lo maneja bien como boolean
                        'fecha_envio' => now(),
                        'created_at'  => now(),
                        'updated_at'  => now(),
                    ]);
                }
            }
 
            DB::commit();
 
            // Para compatibilidad con tu frontend
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
 
    // -------- Historial de análisis (sin cambios funcionales) ----------
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
        $items = $query->forPage($page, $perPage)->get();
    
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