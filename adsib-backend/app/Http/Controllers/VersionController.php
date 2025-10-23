<?php

namespace App\Http\Controllers;

use App\Models\VersionConvenio;
use App\Models\Convenio;
use App\Models\Comparacion;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

class VersionController extends Controller
{
    /* ======================= helpers ======================= */

    private function toUtf8(?string $s): ?string
    {
        if ($s === null) return null;
        $enc = mb_detect_encoding($s, ['UTF-8','ISO-8859-1','Windows-1252'], true) ?: 'UTF-8';
        $out = @iconv($enc, 'UTF-8//IGNORE', $s);
        if ($out === false) {
            return mb_convert_encoding($s, 'UTF-8', $enc) ?: '';
        }
        return $out;
    }

    private function saveFilePath(int $convenioId, int $numeroVersion, \Illuminate\Http\UploadedFile $file): string
    {
        $nameOrig = $this->toUtf8($file->getClientOriginalName());
        $base = pathinfo($nameOrig, PATHINFO_FILENAME);
        $ext  = strtolower($file->getClientOriginalExtension());
        $safe = Str::slug($base, '-');
        $final = time() . '_' . ($safe ?: 'version') . '.' . $ext;

        // "convenios/{id}/v{N}/archivo.ext"
        return Storage::putFileAs("convenios/{$convenioId}/v{$numeroVersion}", $file, $final);
    }

    /* ---------- extracción de texto (defensiva) ---------- */

    private function getTextFromDocx(string $absPath): ?string
    {
        if (!class_exists(\ZipArchive::class)) return null;

        try {
            $zip = new \ZipArchive();
            if ($zip->open($absPath) !== true) return null;
            $xml = $zip->getFromName('word/document.xml');
            $zip->close();
            if ($xml === false) return null;

            $xml = preg_replace('/<\/w:p>/', "\n", $xml);
            $xml = preg_replace('/<\/w:tr>/', "\n", $xml);
            return $this->toUtf8(strip_tags($xml));
        } catch (\Throwable $e) {
            return null;
        }
    }

    private function getTextFromPdf(string $absPath): ?string
    {
        if (!class_exists(\Smalot\PdfParser\Parser::class)) return null;
        try {
            $parser = new \Smalot\PdfParser\Parser();
            $pdf = $parser->parseFile($absPath);
            return $this->toUtf8($pdf->getText());
        } catch (\Throwable $e) {
            return null;
        }
    }

    private function tryExtractText(string $storagePath): ?string
    {
        $abs = Storage::path($storagePath);
        $ext = strtolower(pathinfo($abs, PATHINFO_EXTENSION));
        if ($ext === 'docx') return $this->getTextFromDocx($abs);
        if ($ext === 'pdf')  return $this->getTextFromPdf($abs);
        return null;
    }

    private function trySize(string $storagePath): ?int
    {
        try { return Storage::size($storagePath); }
        catch (\Throwable $e) { return null; }
    }

    private function makeComparison(VersionConvenio $base, VersionConvenio $comp): Comparacion
    {
        $aPath = $base->archivo_path;
        $bPath = $comp->archivo_path;

        $hashA = @hash_file('sha256', Storage::path($aPath)) ?: null;
        $hashB = @hash_file('sha256', Storage::path($bPath)) ?: null;
        $sizeA = $this->trySize($aPath);
        $sizeB = $this->trySize($bPath);

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
            'version_base_id'        => $base->id,
            'version_comparada_id'   => $comp->id,
            'diferencias_detectadas' => [
                'hash_base'         => $hashA,
                'hash_comp'         => $hashB,
                'size_base'         => $sizeA,
                'size_comp'         => $sizeB,
                'similaridad_texto' => $similar,
            ],
            'resumen_cambios'        => $this->toUtf8($resumen),
            'created_at'             => now(),
        ]);
    }

    /* ======================= endpoints ======================= */

    public function index($convenioId)
    {
        Convenio::findOrFail($convenioId);
        $flat = (int) request('flat', 0) === 1;

        if ($flat) {
            $rows = VersionConvenio::where('convenio_id', $convenioId)
                ->orderByDesc('numero_version')
                ->get();

            return response()->json($rows, 200, [], JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
        }

        $perPage = (int) request('per_page', 10);
        $page    = (int) request('page', 1);

        $paginator = VersionConvenio::where('convenio_id', $convenioId)
            ->orderByDesc('numero_version')
            ->paginate($perPage, ['*'], 'page', $page);

        return response()->json($paginator, 200, [], JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
    }

    public function store(Request $r, $convenioId)
    {
        $c = Convenio::findOrFail($convenioId);

        $r->validate([
            'archivo'       => 'required|file|mimes:pdf,docx|max:20480',
            'observaciones' => 'nullable|string|max:4000',
            'final'         => 'nullable|boolean',
        ]);

        $file = $r->file('archivo');
        $name = $this->toUtf8($file->getClientOriginalName());

        $next = (int) VersionConvenio::where('convenio_id', $c->id)->max('numero_version') + 1;
        $path = $this->saveFilePath($c->id, $next, $file);

        $obs  = $r->boolean('final')
            ? 'Versión final'
            : ($this->toUtf8($r->input('observaciones')) ?: 'Actualización');

        // 🔹 Nuevo: intentar extraer texto del documento y guardarlo
        $textoExtraido = $this->tryExtractText($path);

        $version = VersionConvenio::create([
            'convenio_id'              => $c->id,
            'numero_version'           => $next,
            'archivo_nombre_original'  => $name,
            'archivo_path'             => $path,
            'fecha_version'            => now(),
            'observaciones'            => $obs,
            'texto'                    => $textoExtraido, // 👈 aquí se guarda el texto para el asistente
            'created_at'               => now(),
        ]);

        $prev = VersionConvenio::where('convenio_id', $c->id)
            ->where('numero_version', $next - 1)
            ->first();

        $cmp = null;
        if ($prev) $cmp = $this->makeComparison($prev, $version);

        $c->archivo_nombre_original = $name;
        $c->archivo_path            = $path;

        if ($r->boolean('final')) {
            $c->estado = 'CERRADO';
        } elseif ($c->estado === 'BORRADOR') {
            $c->estado = 'NEGOCIACION';
        }
        $c->save();

        return response()->json(
            ['version' => $version, 'comparacion' => $cmp],
            201,
            [],
            JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE
        );
    }

    public function download($versionId)
    {
        $v = VersionConvenio::findOrFail($versionId);
        $name = $this->toUtf8($v->archivo_nombre_original ?: "version_v{$v->numero_version}.pdf");
        return Storage::download($v->archivo_path, $name);
    }

    public function destroy($versionId)
    {
        $v = VersionConvenio::findOrFail($versionId);
        if ($v->archivo_path) Storage::delete($v->archivo_path);
        $v->delete();
        return response()->json(['ok' => true]);
    }

    public function text($versionId)
    {
        $v = VersionConvenio::findOrFail($versionId);
        $txt = $v->texto ?: $this->tryExtractText($v->archivo_path);
        if ($txt === null) {
            return response()->json(
                ['message' => 'No se pudo extraer texto (requiere DOCX/PDF y, para DOCX, la extensión ZIP).'],
                422
            );
        }
        return response()->json(['text' => $txt], 200, [], JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
    }
}