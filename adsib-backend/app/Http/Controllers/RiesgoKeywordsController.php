<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class RiesgoKeywordsController extends Controller
{
    /**
     * GET /riesgos/keywords
     * Parámetros opcionales:
     *  - q: texto de búsqueda
     *  - severity: HIGH|MEDIUM|LOW
     *  - only_active: true/false
     *  - page, per
     */
    public function index(Request $request)
    {
        $perPage = (int) ($request->query('per') ?? 20);
        $perPage = $perPage > 0 ? min($perPage, 100) : 20;

        $page = (int) ($request->query('page') ?? 1);
        $page = max(1, $page);

        $search     = trim((string) $request->query('q', ''));
        $severity   = strtoupper((string) $request->query('severity', ''));
        $onlyActive = filter_var($request->query('only_active', 'false'), FILTER_VALIDATE_BOOLEAN);

        $q = DB::table('riesgo_keywords')->orderBy('texto');

        if ($search !== '') {
            // usa ILIKE en Postgres
            $q->where('texto', 'ILIKE', '%' . $search . '%');
        }

        if (in_array($severity, ['HIGH', 'MEDIUM', 'LOW'], true)) {
            $q->where('severity', $severity);
        }

        if ($onlyActive) {
            $q->where('activo', true);
        }

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

    /**
     * POST /riesgos/keywords
     * Crea un término nuevo.
     */
    public function store(Request $request)
    {
        $request->validate([
            'texto' => 'required|string|max:255',
            'severity' => 'required|in:HIGH,MEDIUM,LOW',
            'reason' => 'nullable|string',
            'activo' => 'boolean'
        ]);

        try {
            // normaliza el texto para evitar duplicados invisibles
            $texto = trim(mb_strtolower($request->texto));

            // valida duplicado de forma amigable
            if (DB::table('riesgo_keywords')->whereRaw('LOWER(texto) = ?', [$texto])->exists()) {
                return response()->json([
                    'message' => 'Este término ya existe en el diccionario.'
                ], 409);
            }

            DB::table('riesgo_keywords')->insert([
                'texto' => $request->texto,
                'severity' => $request->severity,
                'reason' => $request->reason,
                'activo' => $request->activo ? 1 : 0,
                'created_at' => now(),
                'updated_at' => now(),
            ]);

            return response()->json(['message' => 'Término creado correctamente'], 201);

        } catch (\Throwable $e) {
            return response()->json([
                'message' => 'No se pudo procesar la creación del término.'
            ], 500);
        }
    }

    /**
     * PUT/PATCH /riesgos/keywords/{id}
     * Actualiza un término existente.
     */
    public function update(Request $request, $id)
    {
        $request->validate([
            'texto' => 'required|string|max:255',
            'severity' => 'required|in:HIGH,MEDIUM,LOW',
            'reason' => 'nullable|string',
            'activo' => 'boolean'
        ]);

        try {
            $texto = trim(mb_strtolower($request->texto));

            // validar duplicado excepto este mismo id
            if (DB::table('riesgo_keywords')
                ->whereRaw('LOWER(texto) = ?', [$texto])
                ->where('id', '!=', $id)
                ->exists()) {

                return response()->json([
                    'message' => 'Otro término con este texto ya existe.'
                ], 409);
            }

            DB::table('riesgo_keywords')->where('id', $id)->update([
                'texto' => $request->texto,
                'severity' => $request->severity,
                'reason' => $request->reason,
                'activo' => $request->activo ? 1 : 0,
                'updated_at' => now(),
            ]);

            return response()->json(['message' => 'Término actualizado correctamente'], 200);

        } catch (\Throwable $e) {
            return response()->json([
                'message' => 'No se pudo actualizar el término.'
            ], 500);
        }
    }

    /**
     * DELETE /riesgos/keywords/{id}
     * En vez de borrar físico, marcamos activo = false.
     */
    public function destroy(int $id)
    {
        $row = DB::table('riesgo_keywords')->where('id', $id)->first();
        if (!$row) {
            return response()->json(['message' => 'Registro no encontrado'], 404);
        }

        DB::table('riesgo_keywords')->where('id', $id)->update([
            'activo'     => false,
            'updated_at' => now(),
        ]);

        return response()->json(['ok' => true], 200);
    }
}