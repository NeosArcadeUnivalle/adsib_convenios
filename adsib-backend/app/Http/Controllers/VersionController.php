<?php

namespace App\Http\Controllers;

use App\Models\VersionConvenio;
use App\Models\Convenio;
use App\Models\Comparacion;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use App\Http\Requests\VersionStoreRequest;
use Illuminate\Support\Str;

class VersionController extends Controller
{
    /* ======================= helpers ======================= */

    /**
     * Normaliza cadenas a UTF-8 sin romper por caracteres inválidos.
     */
    private function toUtf8(?string $s): ?string
    {
        if ($s === null) return null;

        // Detecta mejor esfuerzo; si falla asumimos UTF-8
        $enc = mb_detect_encoding($s, ['UTF-8', 'ISO-8859-1', 'Windows-1252'], true) ?: 'UTF-8';
        $out = @iconv($enc, 'UTF-8//IGNORE', $s);

        if ($out === false) {
            // Último recurso
            return mb_convert_encoding($s, 'UTF-8', $enc) ?: '';
        }
        return $out;
    }

    /**
     * Guarda el archivo en una ruta estable dentro de storage/app.
     * Ej: convenios/{id}/v{N}/timestamp_nombre.ext
     */
    private function saveFilePath(int $convenioId, int $numeroVersion, \Illuminate\Http\UploadedFile $file): string
    {
        $nameOrig = $this->toUtf8($file->getClientOriginalName());
        $base = pathinfo($nameOrig, PATHINFO_FILENAME);
        $ext  = strtolower($file->getClientOriginalExtension());
        $safe = Str::slug($base, '-');
        $final = time() . '_' . ($safe ?: 'version') . '.' . $ext;

        return Storage::putFileAs("convenios/{$convenioId}/v{$numeroVersion}", $file, $final);
    }

    /* ---------------- extracción de texto (defensiva) ---------------- */

    /**
     * Extrae texto desde DOCX si la extensión zip está disponible.
     * Devuelve null si no puede extraer (no lanza excepciones).
     */
    private function getTextFromDocx(string $absPath): ?string
    {
        // Evita 500 cuando no está habilitada la extensión
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

            // Inserta saltos al final de párrafos/filas de tabla
            $xml = preg_replace('/<\/w:p>/', "\n", $xml);
            $xml = preg_replace('/<\/w:tr>/', "\n", $xml);

            $txt = strip_tags($xml);
            return $this->toUtf8($txt);
        } catch (\Throwable $e) {
            // No rompas el guardado de la versión
            return null;
        }
    }

    /**
     * Extrae texto desde PDF usando smalot/pdfparser si está disponible.
     */
    private function getTextFromPdf(string $absPath): ?string
    {
        if (!class_exists(\Smalot\PdfParser\Parser::class)) {
            return null;
        }

        try {
            $parser = new \Smalot\PdfParser\Parser();
            $pdf = $parser->parseFile($absPath);
            $text = $pdf->getText();
            return $this->toUtf8($text);
        } catch (\Throwable $e) {
            return null;
        }
    }

    /**
     * Intenta extraer texto según extensión; si no puede, retorna null.
     */
    private function tryExtractText(string $storagePath): ?string
    {
        $abs = Storage::path($storagePath);
        $ext = strtolower(pathinfo($abs, PATHINFO_EXTENSION));

        if ($ext === 'docx') return $this->getTextFromDocx($abs);
        if ($ext === 'pdf')  return $this->getTextFromPdf($abs);

        return null;
    }

    /**
     * Crea y guarda un registro de comparación (resumen + hashes/tamaño).
     * No falla si no hay texto (cae a comparación binaria).
     */
    private function makeComparison(VersionConvenio $base, VersionConvenio $comp): Comparacion
    {
        $aPath = $base->archivo_path;
        $bPath = $comp->archivo_path;

        // Hash sin cargar todo a memoria
        $hashA = @hash_file('sha256', Storage::path($aPath)) ?: null;
        $hashB = @hash_file('sha256', Storage::path($bPath)) ?: null;
        $sizeA = Storage::size($aPath);
        $sizeB = Storage::size($bPath);

        $txtA  = $this->tryExtractText($aPath);
        $txtB  = $this->tryExtractText($bPath);

        $similar = null;
        $resumen = '';

        if ($txtA !== null && $txtB !== null) {
            similar_text($txtA, $txtB, $pct);
            $similar = round($pct, 2);
            $resumen = $similar >= 99.9
                ? "Coincidencia {$similar}%. Sin cambios relevantes."
                : "Coincidencia {$similar}%. Cambios detectados.";
        } else {
            if ($hashA !== null && $hashB !== null && $hashA === $hashB) {
                $resumen = "Archivos idénticos (hash).";
            } else {
                $resumen = "Cambios detectados (comparación binaria).";
            }
        }

        return Comparacion::create([
            'version_base_id'         => $base->id,
            'version_comparada_id'    => $comp->id,
            'diferencias_detectadas'  => [
                'hash_base'        => $hashA,
                'hash_comp'        => $hashB,
                'size_base'        => $sizeA,
                'size_comp'        => $sizeB,
                'similaridad_texto'=> $similar,
            ],
            'resumen_cambios'         => $this->toUtf8($resumen),
            'created_at'              => now(),
        ]);
    }

    /* ======================= endpoints ======================= */

    /** Listar versiones de un convenio (desc). */
    public function index($convenioId)
    {
        Convenio::findOrFail($convenioId);

        $v = VersionConvenio::where('convenio_id', $convenioId)
            ->orderByDesc('numero_version')
            ->get();

        return response()->json(
            $v,
            200,
            [],
            JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE
        );
    }

    /**
     * Crear versión + comparación con la anterior.
     * Usa VersionStoreRequest para validar el archivo/observaciones.
     */
    public function store(VersionStoreRequest $r, $convenioId)
    {
        $data = $r->validated();

        $c = Convenio::findOrFail($convenioId);

        $next = (int) VersionConvenio::where('convenio_id', $c->id)->max('numero_version') + 1;
        $path = $this->saveFilePath($c->id, $next, $r->file('archivo'));

        $version = VersionConvenio::create([
            'convenio_id'             => $c->id,
            'numero_version'          => $next,
            'archivo_nombre_original' => $this->toUtf8($r->file('archivo')->getClientOriginalName()),
            'archivo_path'            => $path,
            'fecha_version'           => now(),
            'observaciones'           => $this->toUtf8($data['observaciones'] ?? null),
            'created_at'              => now(),
        ]);

        // Compara automáticamente con la anterior si existe
        $prev = VersionConvenio::where('convenio_id', $c->id)
            ->where('numero_version', $next - 1)
            ->first();

        $cmp = null;
        if ($prev) {
            $cmp = $this->makeComparison($prev, $version);
        }

        return response()->json(
            ['version' => $version, 'comparacion' => $cmp],
            201,
            [],
            JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE
        );
    }

    /** Descargar archivo de una versión. */
    public function download($versionId)
    {
        $v = VersionConvenio::findOrFail($versionId);
        $name = $this->toUtf8($v->archivo_nombre_original ?: "version_v{$v->numero_version}.pdf");

        return Storage::download($v->archivo_path, $name);
    }

    /** Eliminar versión y su archivo. */
    public function destroy($versionId)
    {
        $v = VersionConvenio::findOrFail($versionId);

        if ($v->archivo_path) {
            Storage::delete($v->archivo_path);
        }

        $v->delete();

        return response()->json(['ok' => true]);
    }

    /**
     * Texto extraído de la versión (para comparador/analizador).
     * 200 con {text} cuando hay extracción;
     * 422 con mensaje si no se pudo extraer (extensión no soportada o falta lib).
     */
    public function text($versionId)
    {
        $v = VersionConvenio::findOrFail($versionId);

        $txt = $this->tryExtractText($v->archivo_path);
        if ($txt === null) {
            return response()->json(
                ['message' => 'No se pudo extraer texto (requiere DOCX/PDF y, para DOCX, la extensión ZIP).'],
                422
            );
        }

        return response()->json(
            ['text' => $txt],
            200,
            [],
            JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE
        );
    }
}