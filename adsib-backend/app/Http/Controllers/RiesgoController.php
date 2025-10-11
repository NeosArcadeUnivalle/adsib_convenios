<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class RiesgosController extends Controller
{
    public function dataset(Request $request)
    {
        $versionId = $request->query('version_id');
        $perPage   = (int) ($request->query('per') ?? 20);
        $page      = (int) ($request->query('page') ?? 1);

        if (!$versionId) {
            return response()->json(['message' => 'version_id es requerido'], 422);
        }

        $q = DB::table('riesgo_dataset')
            ->where('version_id', $versionId)
            ->orderByDesc('created_at');

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
        ]);
    }
}