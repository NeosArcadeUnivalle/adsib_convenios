<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class RiesgoKeywordsController extends Controller
{
    protected function isLikelyAcronym(string $token): bool
    {
        return preg_match('/^[A-Z]{2,}$/u', $token) === 1;
    }

    protected function maxDistanceForLength(int $len): int
    {
        if ($len <= 4) return 1;
        if ($len <= 7) return 2;
        return 3;
    }

    protected function normalizeToken(string $t): string
    {
        $t = mb_strtolower($t);
        $t = preg_replace('/[^\p{L}]+/u', '', $t);
        $t = strtr($t, [
            'á' => 'a', 'é' => 'e', 'í' => 'i', 'ó' => 'o', 'ú' => 'u', 'ü' => 'u',
            'Á' => 'a', 'É' => 'e', 'Í' => 'i', 'Ó' => 'o', 'Ú' => 'u', 'Ü' => 'u',
        ]);
        return (string) $t;
    }

    protected function getKnownTokens(): array
    {
        $base = [
            'precio','precios','presupuesto','presupuestario','descuento','descuentos',
            'reemision','reemisiones','minimo','minima','minimos','minimas',
            'orden','cantidad','techo','limite','preferencial','preferenciales',
            'reducido','reducidos','modificable','modificables','unico','unica',
            'compra','compras','bajo','bajos','alto','altos','medio','medios',
            'obligado','obligados','obligacion','obligaciones',
            'clausula','clausulas','alerta','alertas','temprana','tempranas'
        ];

        $set = [];
        foreach ($base as $b) {
            $set[$this->normalizeToken($b)] = true;
        }

        try {
            $rows = DB::table('riesgo_keywords')->select('texto')->get();
            foreach ($rows as $r) {
                $txt = (string) ($r->texto ?? '');
                if ($txt === '') {
                    continue;
                }
                if (preg_match_all('/[\p{L}]+/u', $txt, $m)) {
                    foreach ($m[0] as $tok) {
                        $norm = $this->normalizeToken($tok);
                        if ($norm !== '') {
                            $set[$norm] = true;
                        }
                    }
                }
            }
        } catch (\Throwable $e) {
            // si falla la BD, seguimos solo con la base
        }

        return $set;
    }

    /**
     * Heuristica suave para evitar textos basura (no bloquea frases cortas validas).
     */
    protected function isClauseLike(string $text, array &$reasons = []): bool
    {
        $reasons = [];
        $raw = trim($text);

        if ($raw === '') {
            $reasons[] = 'texto vacio';
            return false;
        }

        $len = mb_strlen($raw);
        if ($len < 3) {
            $reasons[] = 'demasiado corto';
        }

        $total = mb_strlen($raw);
        $letters = mb_strlen(preg_replace('/[^\p{L}]+/u', '', $raw));
        if ($letters < 3) {
            $reasons[] = 'muy pocas letras';
        }

        if ($total > 0) {
            $ratio = $letters / $total;
            if ($ratio < 0.4) {
                $reasons[] = 'demasiados simbolos o numeros';
            }
        }

        // Heuristica anti-gibberish para palabras sueltas largas
        if (!str_contains($raw, ' ')) {
            $lower = mb_strtolower($raw);
            $allowStems = [
                'precio','presup','descuent','reemision','minim','orden',
                'cantidad','techo','limite','preferenc','reduc','modific',
                'unico','compra','bajo','alto','medio'
            ];

            $hasStem = false;
            foreach ($allowStems as $s) {
                if (mb_strpos($lower, $s) !== false) {
                    $hasStem = true;
                    break;
                }
            }

            if ($len >= 8 && !$hasStem) {
                if (preg_match('/(?iu)[bcdfghjklmnñpqrstvwxyz]{3,}/', $lower)) {
                    $reasons[] = 'palabra incoherente';
                }
            }
        }

        // Heuristica de posible falta ortografica (solo si se parece a un termino conocido)
        if (preg_match_all('/[\p{L}]+/u', $raw, $m)) {
            $known = $this->getKnownTokens();
            $tokens = $m[0];
            $typoReason = null;
            $unknown = [];
            foreach ($tokens as $tok) {
                $norm = $this->normalizeToken($tok);
                $len = mb_strlen($norm);
                if ($norm === '' || $len < 3 || $this->isLikelyAcronym($tok)) {
                    continue;
                }
                if (isset($known[$norm])) {
                    continue;
                }
                $best = null;
                $bestDist = 99;
                foreach ($known as $k => $_) {
                    if (abs(strlen($k) - strlen($norm)) > 2) {
                        continue;
                    }
                    $d = levenshtein($norm, $k);
                    if ($d < $bestDist) {
                        $bestDist = $d;
                        $best = $k;
                        if ($d <= 1) {
                            break;
                        }
                    }
                }
                $maxDist = $this->maxDistanceForLength((int)$len);
                if ($best !== null && $bestDist <= $maxDist) {
                    $typoReason = 'posible error: "' . $tok . '" -> "' . $best . '"';
                    break;
                }

                $unknown[] = $tok;
            }

            if ($typoReason !== null) {
                $reasons[] = $typoReason;
            } elseif (count($tokens) === 1 && !empty($unknown)) {
                $reasons[] = 'palabra no reconocida: "' . $unknown[0] . '"';
            }
        }

        return empty($reasons);
    }

    /**
     * GET /riesgos/keywords/known-tokens
     */
    public function knownTokens()
    {
        try {
            $known = array_keys($this->getKnownTokens());
            sort($known);

            return response()->json([
                'data' => $known,
                'meta' => ['total' => count($known)],
            ], 200, [], JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
        } catch (\Throwable $e) {
            return response()->json([
                'message' => 'No se pudieron cargar los tokens conocidos.',
            ], 500);
        }
    }
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
            $reasons = [];
            if (!$this->isClauseLike((string) $request->texto, $reasons)) {
                $msg = 'La clausula no parece coherente.';
                if (!empty($reasons)) {
                    $msg .= ' Motivos: ' . implode(', ', $reasons) . '.';
                }
                return response()->json(['message' => $msg], 422);
            }

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
            $reasons = [];
            if (!$this->isClauseLike((string) $request->texto, $reasons)) {
                $msg = 'La clausula no parece coherente.';
                if (!empty($reasons)) {
                    $msg .= ' Motivos: ' . implode(', ', $reasons) . '.';
                }
                return response()->json(['message' => $msg], 422);
            }

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
