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
        $text       = (string) ($request->input('text') ?? '');
        $convenioId = $request->input('convenio_id');
        $versionId  = $request->input('version_id');

        if (trim($text) === '') {
            return response()->json(['message' => 'El texto a analizar está vacío.'], 422);
        }

        $resp = $this->nlp->analyze($text);
        if (!$resp['ok']) {
            return response()->json([
                'message' => 'No se pudo procesar el análisis.',
                'detail'  => $resp['error'] ?? 'Error',
            ], 502);
        }

        $data      = $resp['data'] ?? [];
        $riskLevel = (string) ($data['risk_level'] ?? 'BAJO');
        $score     = (float) ($data['score'] ?? 0);
        $matches   = $data['matches'] ?? [];
        $modelo    = (string) ($data['summary']['model_embedder'] ?? 'rules+model');

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

        if (is_array($matches) && count($matches)) {
            $bulk = [];
            foreach ($matches as $m) {
                $bulk[] = [
                    'convenio_id' => $convenioId,
                    'version_id'  => $versionId,
                    'page'        => $m['page']   ?? null,
                    'line'        => $m['line']   ?? null,
                    'start'       => $m['start']  ?? null,
                    'end'         => $m['end']    ?? null,
                    'text'        => $m['token']  ?? '',
                    'label_json'  => json_encode([
                        'severity' => $m['severity'] ?? null,
                        'reason'   => $m['reason']   ?? null,
                    ], JSON_UNESCAPED_UNICODE),
                    'source'      => $m['source'] ?? null, // keyword|pattern|semantic
                    'created_at'  => now(),
                    'updated_at'  => now(),
                ];
            }
            DB::table('riesgo_dataset')->insert($bulk);
        }

        $data['saved_id'] = $idAnalisis;
        return response()->json($data, 200);
    }

    public function index(Request $request)
    {
        $versionId = $request->query('version_id');
        $perPage   = (int) ($request->query('per') ?? 10);
        $page      = (int) ($request->query('page') ?? 1);

        if (!$versionId) {
            return response()->json(['message' => 'version_id es requerido'], 422);
        }

        $query = DB::table('analisis_riesgos')
            ->where('version_id', $versionId)
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