<?php
 
namespace App\Http\Controllers;
 
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
 
class RiesgosController extends Controller
{
    /**
     * Devuelve el dataset de riesgo asociado a una versión.
     * GET /analisis/dataset?version_id=ID&per=20&page=1
     *
     * Respuesta:
     * {
     *   "data": [...],
     *   "meta": { "page": 1, "per": 20, "total": 123, "hasMore": true }
     * }
     */
    public function dataset(Request $request)
    {
        // Validación ligera
        $versionId = $request->query('version_id');
        if (empty($versionId) || !ctype_digit((string)$versionId)) {
            return response()->json(['message' => 'version_id es requerido y debe ser entero'], 422);
        }
        $versionId = (int) $versionId;
 
        $perPage = (int) ($request->query('per') ?? 20);
        $perPage = $perPage > 0 ? min($perPage, 100) : 20;
 
        $page = (int) ($request->query('page') ?? 1);
        $page = max(1, $page);
 
        // Query base
        $q = DB::table('riesgo_dataset')
            ->where('version_id', $versionId)
            ->orderByDesc('created_at')
            ->orderByDesc('id'); // desempate estable
 
        $total = (clone $q)->count();
        $rows  = $q->forPage($page, $perPage)->get();
 
        return response()->json([
            'data' => $rows,
            'meta' => [
                'page'    => $page,
                'per'     => $perPage,
                'total'   => $total,
                'hasMore' => ($page * $perPage) < $total,
            ],
        ], 200, [], JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
    }
}