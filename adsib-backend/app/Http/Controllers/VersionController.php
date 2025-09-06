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
    /* ---------------- helpers ---------------- */

    private function toUtf8(?string $s): ?string {
        if ($s === null) return null;
        $enc = mb_detect_encoding($s, ['UTF-8','ISO-8859-1','Windows-1252'], true) ?: 'UTF-8';
        $out = iconv($enc, 'UTF-8//IGNORE', $s);
        return $out === false ? '' : $out;
    }

    private function saveFilePath(int $convenioId, int $numeroVersion, \Illuminate\Http\UploadedFile $file): string {
        $nameOrig = $this->toUtf8($file->getClientOriginalName());
        $base = pathinfo($nameOrig, PATHINFO_FILENAME);
        $ext  = strtolower($file->getClientOriginalExtension());
        $safe = Str::slug($base, '-');
        $final = time().'_'.($safe ?: 'version').'.'.$ext;
        return Storage::putFileAs("convenios/$convenioId/v$numeroVersion", $file, $final);
    }

    /* ---- extracción de texto ---- */

    private function getTextFromDocx(string $absPath): ?string {
        // Lee el XML principal del DOCX
        $zip = new \ZipArchive();
        if ($zip->open($absPath) === true) {
            $xml = $zip->getFromName('word/document.xml');
            $zip->close();
            if ($xml === false) return null;
            $txt = strip_tags($xml);
            return $this->toUtf8($txt);
        }
        return null;
    }

    private function getTextFromPdf(string $absPath): ?string {
        // Requiere: composer require smalot/pdfparser
        try {
            $parser = new \Smalot\PdfParser\Parser();
            $pdf = $parser->parseFile($absPath);
            $text = $pdf->getText();
            return $this->toUtf8($text);
        } catch (\Throwable $e) {
            return null;
        }
    }

    private function tryExtractText(string $storagePath): ?string {
        $abs = Storage::path($storagePath);
        $ext = strtolower(pathinfo($abs, PATHINFO_EXTENSION));
        if ($ext === 'docx') return $this->getTextFromDocx($abs);
        if ($ext === 'pdf')  return $this->getTextFromPdf($abs);
        return null;
    }

    private function makeComparison(VersionConvenio $base, VersionConvenio $comp): Comparacion {
        $aPath = $base->archivo_path;
        $bPath = $comp->archivo_path;

        $hashA = hash('sha256', Storage::get($aPath));
        $hashB = hash('sha256', Storage::get($bPath));
        $sizeA = Storage::size($aPath);
        $sizeB = Storage::size($bPath);

        $txtA  = $this->tryExtractText($aPath);
        $txtB  = $this->tryExtractText($bPath);

        $similar = null; $resumen = '';
        if ($txtA !== null && $txtB !== null) {
            similar_text($txtA, $txtB, $pct);
            $similar = round($pct, 2);
            $resumen = $similar >= 99.9
                ? "Coincidencia {$similar}%. Sin cambios relevantes."
                : "Coincidencia {$similar}%. Cambios detectados.";
        } else {
            $resumen = $hashA === $hashB
                ? "Archivos idénticos (hash)."
                : "Cambios detectados (comparación binaria).";
        }

        return Comparacion::create([
            'version_base_id'      => $base->id,
            'version_comparada_id' => $comp->id,
            'diferencias_detectadas' => [
                'hash_base' => $hashA, 'hash_comp' => $hashB,
                'size_base' => $sizeA, 'size_comp' => $sizeB,
                'similaridad_texto' => $similar,
            ],
            'resumen_cambios' => $this->toUtf8($resumen),
            'created_at' => now(),
        ]);
    }

    /* ---------------- endpoints ---------------- */

    // Listar versiones (desc)
    public function index($convenioId) {
        Convenio::findOrFail($convenioId);
        $v = VersionConvenio::where('convenio_id',$convenioId)
            ->orderByDesc('numero_version')->get();
        return response()->json($v, 200, [], JSON_UNESCAPED_UNICODE|JSON_INVALID_UTF8_SUBSTITUTE);
    }

    // Crear versión + comparación con la anterior (usa FormRequest)
    public function store(VersionStoreRequest $r, $convenioId) {
        $data = $r->validated(); // <-- reglas en VersionStoreRequest
        $c = Convenio::findOrFail($convenioId);

        $next = (int) VersionConvenio::where('convenio_id',$c->id)->max('numero_version') + 1;
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

        $prev = VersionConvenio::where('convenio_id',$c->id)
            ->where('numero_version', $next-1)->first();

        $cmp = null;
        if ($prev) $cmp = $this->makeComparison($prev, $version);

        return response()->json([
            'version'     => $version,
            'comparacion' => $cmp
        ], 201, [], JSON_UNESCAPED_UNICODE|JSON_INVALID_UTF8_SUBSTITUTE);
    }

    public function download($versionId) {
        $v = VersionConvenio::findOrFail($versionId);
        $name = $this->toUtf8($v->archivo_nombre_original ?: "version_v{$v->numero_version}.pdf");
        return Storage::download($v->archivo_path, $name);
    }

    public function destroy($versionId) {
        $v = VersionConvenio::findOrFail($versionId);
        if ($v->archivo_path) Storage::delete($v->archivo_path);
        $v->delete();
        return response()->json(['ok'=>true]);
    }

    // Texto extraído (para comparación manual en el front)
    public function text($versionId) {
        $v = VersionConvenio::findOrFail($versionId);
        $txt = $this->tryExtractText($v->archivo_path);
        if ($txt === null) {
            return response()->json(['message' => 'No se pudo extraer texto (solo DOCX/PDF soportados).'], 422);
        }
        return response()->json(['text' => $txt], 200, [], JSON_UNESCAPED_UNICODE|JSON_INVALID_UTF8_SUBSTITUTE);
    }
}