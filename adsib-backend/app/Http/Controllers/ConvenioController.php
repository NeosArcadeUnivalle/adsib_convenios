<?php

namespace App\Http\Controllers;

use App\Models\Convenio;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
// 👇 importa las FormRequest
use App\Http\Requests\ConvenioStoreRequest;
use App\Http\Requests\ConvenioUpdateRequest;

class ConvenioController extends Controller
{
    /* ---------- helpers ---------- */
    private function toUtf8(?string $s): ?string {
        if ($s === null) return null;
        $enc = mb_detect_encoding($s, ['UTF-8','ISO-8859-1','Windows-1252'], true) ?: 'UTF-8';
        $out = iconv($enc, 'UTF-8//IGNORE', $s);
        return $out === false ? '' : $out;
    }

    private function saveFile(Convenio $c, \Illuminate\Http\UploadedFile $file): void {
        // nombre seguro para guardar
        $nameOrig = $this->toUtf8($file->getClientOriginalName());
        $base     = pathinfo($nameOrig, PATHINFO_FILENAME);
        $ext      = strtolower($file->getClientOriginalExtension());
        $safe     = Str::slug($base, '-');
        $final    = time() . '_' . ($safe ?: 'archivo') . '.' . $ext;

        // carpeta por convenio
        $path = Storage::putFileAs("convenios/{$c->id}", $file, $final);

        $c->archivo_nombre_original = $nameOrig;
        $c->archivo_path = $path;
        $c->save();
    }

    /* ---------- CRUD ---------- */

    // Listado con filtros simples
    public function index(Request $r)
    {
        $q = Convenio::query()
            ->when($r->filled('q'), function($qq) use ($r){
                $t = '%'.strtolower($r->q).'%';
                $qq->where(function($w) use ($t){
                    $w->whereRaw('LOWER(titulo) LIKE ?', [$t])
                      ->orWhereRaw('LOWER(descripcion) LIKE ?', [$t]);
                });
            })
            ->when($r->filled('estado'), function ($qq) use ($r) {
                $qq->where('estado', $r->estado);
            })
            ->when($r->filled('fi_from'), fn($qq)=>$qq->whereDate('fecha_firma','>=',$r->fi_from))
            ->when($r->filled('fi_to'),   fn($qq)=>$qq->whereDate('fecha_firma','<=',$r->fi_to))
            ->when($r->filled('fv_from'), fn($qq)=>$qq->whereDate('fecha_vencimiento','>=',$r->fv_from))
            ->when($r->filled('fv_to'),   fn($qq)=>$qq->whereDate('fecha_vencimiento','<=',$r->fv_to));

        $sort = in_array($r->get('sort'), ['fecha_vencimiento','fecha_firma','titulo','updated_at'])
              ? $r->get('sort') : 'fecha_vencimiento';
        $dir  = strtolower($r->get('dir')) === 'desc' ? 'desc' : 'asc';

        $per  = (int)($r->get('per_page', 10));
        $per  = $per > 0 && $per <= 100 ? $per : 10;

        $q->orderBy($sort, $dir);

        return response()->json($q->paginate($per));
    }

    // 👉 ahora usa ConvenioStoreRequest
    public function store(ConvenioStoreRequest $r)
    {
        $data = $r->validated();

        $c = Convenio::create($data);

        if ($r->hasFile('archivo')) {
            $this->saveFile($c, $r->file('archivo'));
        }

        return response()->json($c, 201, [], JSON_UNESCAPED_UNICODE|JSON_INVALID_UTF8_SUBSTITUTE);
    }

    public function show($id)
    {
        return response()->json(Convenio::findOrFail($id));
    }

    // 👉 ahora usa ConvenioUpdateRequest
    public function update(ConvenioUpdateRequest $r, $id)
    {
        $c = Convenio::findOrFail($id);
        $data = $r->validated();

        $c->update($data);

        if ($r->hasFile('archivo')) {
            if ($c->archivo_path) Storage::delete($c->archivo_path); // reemplazo
            $this->saveFile($c, $r->file('archivo'));
        }

        return response()->json($c, 200, [], JSON_UNESCAPED_UNICODE|JSON_INVALID_UTF8_SUBSTITUTE);
    }

    public function destroy($id)
    {
        $c = Convenio::findOrFail($id);
        if ($c->archivo_path) Storage::delete($c->archivo_path);
        $c->delete();
        return response()->json(['ok'=>true]);
    }

    /* ---------- archivo por convenio ---------- */

    public function uploadArchivo(Request $r, $id)
    {
        $c = Convenio::findOrFail($id);
        $r->validate(['archivo'=>'required|file|mimes:pdf,docx|max:20480']);
        if ($c->archivo_path) Storage::delete($c->archivo_path);
        $this->saveFile($c, $r->file('archivo'));
        return response()->json([
            'archivo_nombre_original'=>$c->archivo_nombre_original,
            'archivo_path'=>$c->archivo_path
        ], 201, [], JSON_UNESCAPED_UNICODE|JSON_INVALID_UTF8_SUBSTITUTE);
    }

    public function descargarArchivo($id)
    {
        $c = Convenio::findOrFail($id);
        if (!$c->archivo_path) return response()->json(['message'=>'No hay archivo'],404);
        $nombre = $this->toUtf8($c->archivo_nombre_original ?: 'archivo.pdf');
        return Storage::download($c->archivo_path, $nombre);
    }

    public function eliminarArchivo($id)
    {
        $c = Convenio::findOrFail($id);
        if ($c->archivo_path) Storage::delete($c->archivo_path);
        $c->archivo_nombre_original = null;
        $c->archivo_path = null;
        $c->save();
        return response()->json(['ok'=>true]);
    }
}