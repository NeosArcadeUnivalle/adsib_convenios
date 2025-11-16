<?php

namespace App\Http\Controllers;

use App\Models\Convenio;
use App\Models\VersionConvenio;
use Carbon\Carbon;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

class ConvenioController extends Controller
{
    /* ===== helpers de codificación ===== */

    private function toUtf8(?string $s): ?string
    {
        if ($s === null) {
            return null;
        }
        // fuerza UTF-8 y reemplaza bytes inválidos
        $s = @mb_convert_encoding($s, 'UTF-8', 'UTF-8, ISO-8859-1, Windows-1252');
        return $s;
    }

    /**
     * Normaliza y limpia el texto extraído para guardarlo en versiones_convenio.texto
     * - Fuerza UTF-8
     * - Decodifica entidades HTML (&quot;, &apos;, &amp;, etc.)
     * - Normaliza saltos de línea
     * - Colapsa espacios
     * - Elimina líneas vacías
     * - Elimina líneas con demasiados dígitos (códigos / basurita)
     * - Elimina líneas que sólo tienen signos/puntuación/símbolos (", '', —, etc.)
     */
    private function normalizeExtractedText(?string $raw): ?string
    {
        if ($raw === null) {
            return null;
        }

        // UTF-8
        $t = $this->toUtf8($raw);

        // Decodificar entidades HTML (&quot;, &apos;, etc.)
        $t = html_entity_decode($t, ENT_QUOTES | ENT_HTML5, 'UTF-8');

        // Normalizar saltos de línea
        $t = preg_replace("/\r\n|\r|\n/u", "\n", $t);

        // Colapsar espacios múltiples en un solo espacio (no tocamos los \n)
        $t = preg_replace("/[ \t]+/u", " ", $t);

        $lines = preg_split("/\n/u", $t);
        $out   = [];

        foreach ($lines as $line) {
            $line = trim($line);

            // 1) fuera líneas vacías
            if ($line === '') {
                continue;
            }

            // 2) fuera líneas que son SOLO signos / símbolos / puntuación (sin letras ni números)
            //    (ej: solo ", solo ', solo '', solo —, etc.)
            if (!preg_match('/[\p{L}\p{N}]/u', $line) && preg_match('/^[\p{P}\p{S}\s]+$/u', $line)) {
                continue;
            }

            // 3) fuera líneas que son casi todo dígitos (códigos raros)
            //    criterio: al menos 6 dígitos y los dígitos >= 40% de la longitud
            $digits = preg_match_all('/\p{N}/u', $line, $m);
            $len    = mb_strlen($line, 'UTF-8');

            if ($len > 0 && $digits >= 6 && ($digits / $len) >= 0.40) {
                continue;
            }

            // El resto se mantiene
            $out[] = $line;
        }

        if (empty($out)) {
            return null;
        }

        return implode("\n", $out);
    }

    /* ===== extracción de texto para apoyar al asistente ===== */

    private function getTextFromDocx(string $absPath): ?string
    {
        if (!class_exists(\ZipArchive::class)) {
            return null;
        }

        try {
            $zip = new \ZipArchive();
            if ($zip->open($absPath) !== true) {
                return null;
            }

            $xml = $zip->getFromName('word/document.xml');
            $zip->close();

            if ($xml === false) {
                return null;
            }

            // Visibilizar saltos de párrafo/filas
            $xml = preg_replace('/<\/w:p>/', "\n", $xml);
            $xml = preg_replace('/<\/w:tr>/', "\n", $xml);

            $plain = strip_tags($xml);

            return $this->normalizeExtractedText($plain);
        } catch (\Throwable $e) {
            return null;
        }
    }

    private function getTextFromPdf(string $absPath): ?string
    {
        if (!class_exists(\Smalot\PdfParser\Parser::class)) {
            return null;
        }

        try {
            $parser = new \Smalot\PdfParser\Parser();
            $pdf    = $parser->parseFile($absPath);
            $text   = $pdf->getText();

            return $this->normalizeExtractedText($text);
        } catch (\Throwable $e) {
            return null;
        }
    }

    private function tryExtractText(string $storagePath): ?string
    {
        $abs = Storage::path($storagePath);
        $ext = strtolower(pathinfo($abs, PATHINFO_EXTENSION));

        if ($ext === 'docx') {
            return $this->getTextFromDocx($abs);
        }
        if ($ext === 'pdf') {
            return $this->getTextFromPdf($abs);
        }

        return null;
    }

    /* ===== lógica de estados por fechas ===== */

    private function setEstadoPorFechas(Convenio $c): void
    {
        if ($c->estado === 'CERRADO') {
            return;
        }

        if ($c->fecha_vencimiento) {
            $hoy = Carbon::today(config('app.timezone'));
            $fv  = Carbon::parse($c->fecha_vencimiento);

            if ($fv->lt($hoy)) {
                $c->estado = 'VENCIDO';
                $c->save();
                return;
            }
        }

        // Si no venció: si tiene archivo => NEGOCIACION; si no => BORRADOR
        if ($c->archivo_path) {
            if ($c->estado !== 'NEGOCIACION') {
                $c->estado = 'NEGOCIACION';
                $c->save();
            }
        } else {
            if ($c->estado !== 'BORRADOR') {
                $c->estado = 'BORRADOR';
                $c->save();
            }
        }
    }

    private function crearVersionInicial(Convenio $c, string $path, string $name): void
    {
        $yaTieneV1 = VersionConvenio::where('convenio_id', $c->id)
            ->where('numero_version', 1)
            ->exists();

        if (!$yaTieneV1) {
            $texto = $this->tryExtractText($path);

            VersionConvenio::create([
                'convenio_id'             => $c->id,
                'numero_version'          => 1,
                'archivo_nombre_original' => $this->toUtf8($name),
                'archivo_path'            => $path,
                'fecha_version'           => now(),
                'observaciones'           => 'Archivo inicial',
                'texto'                   => $texto,
                'created_at'              => now(),
            ]);
        }
    }

    /* ---------------- CRUD ---------------- */

    public function index(Request $r)
    {
        $q = Convenio::query()
            ->when($r->filled('q'), function ($qq) use ($r) {
                $t = '%' . strtolower($r->q) . '%';
                $qq->where(function ($w) use ($t) {
                    $w->whereRaw('LOWER(titulo) LIKE ?', [$t])
                        ->orWhereRaw('LOWER(descripcion) LIKE ?', [$t]);
                });
            })
            ->when($r->filled('estado'), fn($qq) => $qq->where('estado', $r->estado))
            ->when($r->filled('fi_from'), fn($qq) => $qq->whereDate('fecha_firma', '>=', $r->fi_from))
            ->when($r->filled('fi_to'), fn($qq) => $qq->whereDate('fecha_firma', '<=', $r->fi_to))
            ->when($r->filled('fv_from'), fn($qq) => $qq->whereDate('fecha_vencimiento', '>=', $r->fv_from))
            ->when($r->filled('fv_to'), fn($qq) => $qq->whereDate('fecha_vencimiento', '<=', $r->fv_to));

        $sort = in_array($r->get('sort'), ['fecha_vencimiento', 'fecha_firma', 'titulo', 'updated_at'])
            ? $r->get('sort')
            : 'fecha_vencimiento';

        $dir = strtolower($r->get('dir')) === 'desc' ? 'desc' : 'asc';

        $per = (int)($r->get('per_page', 10));
        $per = $per > 0 && $per <= 100 ? $per : 10;

        $q->orderBy($sort, $dir);

        // Refrescar vencidos
        $this->refreshEstadosVencidosSilencioso();

        return response()->json($q->paginate($per));
    }

    public function store(Request $r)
    {
        $data = $r->validate([
            'titulo'            => 'required|string|min:3|max:200',
            'descripcion'       => 'nullable|string|max:4000',
            'fecha_firma'       => 'nullable|date',
            'fecha_vencimiento' => 'nullable|date',
            'archivo'           => 'nullable|file|mimes:pdf,docx|max:20480',
        ]);

        $estado = $r->hasFile('archivo') ? 'NEGOCIACION' : 'BORRADOR';

        $c = Convenio::create([
            'titulo'             => $this->toUtf8($data['titulo']),
            'descripcion'        => $this->toUtf8($data['descripcion'] ?? null),
            'fecha_firma'        => $data['fecha_firma'] ?? null,
            'fecha_vencimiento'  => $data['fecha_vencimiento'] ?? null,
            'estado'             => $estado,
            'creado_por'         => auth()->id(),
        ]);

        if ($r->hasFile('archivo')) {
            $file = $r->file('archivo');
            $name = $this->toUtf8($file->getClientOriginalName());
            $path = Storage::putFileAs("convenios/{$c->id}", $file, $name);

            $c->archivo_nombre_original = $name;
            $c->archivo_path            = $path;
            $c->save();

            $this->crearVersionInicial($c, $path, $name);
        }

        $this->setEstadoPorFechas($c);

        return response()->json(
            $c,
            201,
            [],
            JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE
        );
    }

    public function show($id)
    {
        $c = Convenio::findOrFail($id);
        $this->setEstadoPorFechas($c);

        return response()->json(
            $c,
            200,
            [],
            JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE
        );
    }

    public function update(Request $r, $id)
    {
        $c = Convenio::findOrFail($id);

        $data = $r->validate([
            'titulo'            => 'required|string|min:3|max:200',
            'descripcion'       => 'nullable|string|max:4000',
            'fecha_firma'       => 'nullable|date',
            'fecha_vencimiento' => 'nullable|date',
            'archivo'           => 'nullable|file|mimes:pdf,docx|max:20480',
            'replace_strategy'  => 'nullable|string',
        ]);

        DB::transaction(function () use ($r, $c, $data) {
            // Campos simples
            $c->update([
                'titulo'            => $this->toUtf8($data['titulo']),
                'descripcion'       => $this->toUtf8($data['descripcion'] ?? null),
                'fecha_firma'       => $data['fecha_firma'] ?? null,
                'fecha_vencimiento' => $data['fecha_vencimiento'] ?? null,
            ]);

            // Archivo
            if ($r->hasFile('archivo')) {
                $file       = $r->file('archivo');
                $origName   = $this->toUtf8($file->getClientOriginalName());
                $storedName = now()->format('Ymd_His') . '_' . $origName;
                $newPath    = Storage::putFileAs("convenios/{$c->id}", $file, $storedName);

                if (!empty($c->archivo_path) && $c->archivo_path !== $newPath) {
                    try {
                        Storage::delete($c->archivo_path);
                    } catch (\Throwable $e) {
                    }
                }

                $c->archivo_nombre_original = $origName;
                $c->archivo_path            = $newPath;

                if ($c->estado === 'BORRADOR') {
                    $c->estado = 'NEGOCIACION';
                }
                $c->save();

                $texto = $this->tryExtractText($newPath);

                $v1 = VersionConvenio::where('convenio_id', $c->id)
                    ->orderBy('numero_version', 'asc')
                    ->first();

                if ($v1) {
                    if (!empty($v1->archivo_path) && $v1->archivo_path !== $newPath) {
                        try {
                            Storage::delete($v1->archivo_path);
                        } catch (\Throwable $e) {
                        }
                    }

                    $v1->archivo_nombre_original = $origName;
                    $v1->archivo_path            = $newPath;
                    $v1->fecha_version           = now();
                    $v1->observaciones           = $v1->observaciones ?: 'Archivo inicial';
                    $v1->texto                   = $texto;
                    $v1->save();
                } else {
                    VersionConvenio::create([
                        'convenio_id'             => $c->id,
                        'numero_version'          => 1,
                        'archivo_nombre_original' => $origName,
                        'archivo_path'            => $newPath,
                        'fecha_version'           => now(),
                        'observaciones'           => 'Archivo inicial',
                        'texto'                   => $texto,
                        'created_at'              => now(),
                    ]);
                }
            }

            $this->setEstadoPorFechas($c);
        });

        return response()->json(
            $c->fresh(),
            200,
            [],
            JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE
        );
    }

    public function destroy($id)
    {
        DB::transaction(function () use ($id) {
            $c = Convenio::findOrFail($id);

            if ($c->archivo_path) {
                Storage::delete($c->archivo_path);
            }

            foreach ($c->versiones as $v) {
                if ($v->archivo_path) {
                    Storage::delete($v->archivo_path);
                }
                $v->delete();
            }

            $c->delete();
        });

        return response()->json(['ok' => true]);
    }

    /* -------- archivos por convenio -------- */

    public function uploadArchivo(Request $r, $id)
    {
        $c = Convenio::findOrFail($id);

        $r->validate([
            'archivo' => 'required|file|mimes:pdf,docx|max:20480',
        ]);

        $file = $r->file('archivo');
        $name = $this->toUtf8($file->getClientOriginalName());
        $path = Storage::putFileAs("convenios/{$c->id}", $file, $name);

        $c->archivo_nombre_original = $name;
        $c->archivo_path            = $path;

        if ($c->estado === 'BORRADOR') {
            $c->estado = 'NEGOCIACION';
        }
        $c->save();

        $max   = (int) VersionConvenio::where('convenio_id', $c->id)->max('numero_version');
        $texto = $this->tryExtractText($path);

        if ($max === 0) {
            VersionConvenio::create([
                'convenio_id'             => $c->id,
                'numero_version'          => 1,
                'archivo_nombre_original' => $name,
                'archivo_path'            => $path,
                'fecha_version'           => now(),
                'observaciones'           => 'Archivo inicial',
                'texto'                   => $texto,
                'created_at'              => now(),
            ]);
        } else {
            VersionConvenio::create([
                'convenio_id'             => $c->id,
                'numero_version'          => $max + 1,
                'archivo_nombre_original' => $name,
                'archivo_path'            => $path,
                'fecha_version'           => now(),
                'observaciones'           => 'Actualización',
                'texto'                   => $texto,
                'created_at'              => now(),
            ]);
        }

        $this->setEstadoPorFechas($c);

        return response()->json(
            [
                'archivo_nombre_original' => $c->archivo_nombre_original,
                'archivo_path'            => $c->archivo_path,
            ],
            201,
            [],
            JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE
        );
    }

    public function descargarArchivo($id)
    {
        $c = Convenio::findOrFail($id);

        if (!$c->archivo_path) {
            return response()->json(['message' => 'No hay archivo'], 404);
        }

        $nombre = $this->toUtf8($c->archivo_nombre_original ?: 'archivo.pdf');

        return Storage::download($c->archivo_path, $nombre);
    }

    public function eliminarArchivo($id)
    {
        $c = Convenio::findOrFail($id);

        if ($c->archivo_path) {
            Storage::delete($c->archivo_path);
        }

        $c->archivo_nombre_original = null;
        $c->archivo_path            = null;

        if (!in_array($c->estado, ['CERRADO', 'VENCIDO'])) {
            $c->estado = 'BORRADOR';
        }

        $c->save();

        return response()->json(['ok' => true]);
    }

    /* -------- mantenimiento silencioso -------- */

    /** Pone en VENCIDO los convenios cuya fecha ya pasó (no CERRADO). */
    private function refreshEstadosVencidosSilencioso(): void
    {
        $hoy = Carbon::today(config('app.timezone'))->toDateString();

        Convenio::whereNotNull('fecha_vencimiento')
            ->where('estado', '!=', 'CERRADO')
            ->whereDate('fecha_vencimiento', '<', $hoy)
            ->update(['estado' => 'VENCIDO']);
    }

    public function reabrir($id)
    {
        $c = Convenio::findOrFail($id);

        if ($c->estado !== 'CERRADO') {
            return response()->json([
                'message' => 'Solo se puede habilitar nuevamente un convenio en estado CERRADO.',
            ], 422);
        }

        $c->estado = 'NEGOCIACION';
        $c->save();

        return response()->json(
            $c,
            200,
            [],
            JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE
        );
    }

    public function patchEstado(Request $r, $id)
    {
        $data = $r->validate([
            'estado' => 'required|in:BORRADOR,NEGOCIACION,CERRADO,VENCIDO',
        ]);

        $c         = Convenio::findOrFail($id);
        $c->estado = $data['estado'];
        $c->save();

        return response()->json(
            $c,
            200,
            [],
            JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE
        );
    }
}