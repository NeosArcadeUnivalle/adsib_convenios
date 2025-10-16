<?php

namespace App\Http\Controllers;

use App\Models\Convenio;
use App\Models\VersionConvenio;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

class ConvenioController extends Controller
{
    /* ---------------- helpers ---------------- */

    private function toUtf8(?string $s): ?string
    {
        if ($s === null) return null;
        $enc = mb_detect_encoding($s, ['UTF-8','ISO-8859-1','Windows-1252'], true) ?: 'UTF-8';
        $out = @iconv($enc, 'UTF-8//IGNORE', $s);
        return $out === false ? $s : $out;
    }

    private function setEstadoPorFechas(Convenio $c): void
    {
        // Si ya está CERRADO, no tocar. Si venció, poner VENCIDO.
        if ($c->estado === 'CERRADO') return;

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
        // Ver si existe V1; si no, crearla con observaciones "Archivo inicial"
        $yaTieneV1 = VersionConvenio::where('convenio_id', $c->id)
            ->where('numero_version', 1)->exists();

        if (!$yaTieneV1) {
            VersionConvenio::create([
                'convenio_id'              => $c->id,
                'numero_version'           => 1,
                'archivo_nombre_original'  => $this->toUtf8($name),
                'archivo_path'             => $path,
                'fecha_version'            => now(),
                'observaciones'            => 'Archivo inicial',
                'created_at'               => now(),
            ]);
        }
    }

    /* ---------------- CRUD ---------------- */

    // Listado con filtros (los que ya usabas)
    public function index(Request $r)
    {
        $q = Convenio::query()
            ->when($r->filled('q'), function ($qq) use ($r) {
                $t = '%'.strtolower($r->q).'%';
                $qq->where(function($w) use ($t){
                    $w->whereRaw('LOWER(titulo) LIKE ?', [$t])
                      ->orWhereRaw('LOWER(descripcion) LIKE ?', [$t]);
                });
            })
            ->when($r->filled('estado'), fn($qq)=>$qq->where('estado',$r->estado))
            ->when($r->filled('fi_from'), fn($qq)=>$qq->whereDate('fecha_firma','>=',$r->fi_from))
            ->when($r->filled('fi_to'),   fn($qq)=>$qq->whereDate('fecha_firma','<=',$r->fi_to))
            ->when($r->filled('fv_from'), fn($qq)=>$qq->whereDate('fecha_vencimiento','>=',$r->fv_from))
            ->when($r->filled('fv_to'),   fn($qq)=>$qq->whereDate('fecha_vencimiento','<=',$r->fv_to));

        $sort = in_array($r->get('sort'), ['fecha_vencimiento','fecha_firma','titulo','updated_at'])
            ? $r->get('sort') : 'fecha_vencimiento';
        $dir  = strtolower($r->get('dir')) === 'desc' ? 'desc' : 'asc';

        $per = (int)($r->get('per_page', 10));
        $per = $per > 0 && $per <= 100 ? $per : 10;

        $q->orderBy($sort, $dir);

        // Antes de responder, refrescamos estados vencidos en lote
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
            'titulo'                   => $this->toUtf8($data['titulo']),
            'descripcion'              => $this->toUtf8($data['descripcion'] ?? null),
            'fecha_firma'              => $data['fecha_firma'] ?? null,
            'fecha_vencimiento'        => $data['fecha_vencimiento'] ?? null,
            'estado'                   => $estado,
            'creado_por'               => auth()->id(),
        ]);

        if ($r->hasFile('archivo')) {
            $file = $r->file('archivo');
            $name = $this->toUtf8($file->getClientOriginalName());
            $path = Storage::putFileAs("convenios/{$c->id}", $file, $name);

            $c->archivo_nombre_original = $name;
            $c->archivo_path = $path;
            $c->save();

            $this->crearVersionInicial($c, $path, $name);
        }

        // Si ya está vencido por fechas, cámbialo a VENCIDO
        $this->setEstadoPorFechas($c);

        return response()->json($c, 201, [], JSON_UNESCAPED_UNICODE|JSON_INVALID_UTF8_SUBSTITUTE);
    }

    public function show($id)
    {
        $c = Convenio::findOrFail($id);
        // Refrescar estado por fechas al consultar
        $this->setEstadoPorFechas($c);
        return response()->json($c, 200, [], JSON_UNESCAPED_UNICODE|JSON_INVALID_UTF8_SUBSTITUTE);
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
        ]);

        $c->update([
            'titulo'            => $this->toUtf8($data['titulo']),
            'descripcion'       => $this->toUtf8($data['descripcion'] ?? null),
            'fecha_firma'       => $data['fecha_firma'] ?? null,
            'fecha_vencimiento' => $data['fecha_vencimiento'] ?? null,
        ]);

        if ($r->hasFile('archivo')) {
            $file = $r->file('archivo');
            $name = $this->toUtf8($file->getClientOriginalName());
            $path = Storage::putFileAs("convenios/{$c->id}", $file, $name);

            $c->archivo_nombre_original = $name;
            $c->archivo_path = $path;

            if ($c->estado === 'BORRADOR') {
                $c->estado = 'NEGOCIACION';
            }
            $c->save();

            // crear nueva versión (n+1)
            $next = ((int) VersionConvenio::where('convenio_id', $c->id)->max('numero_version')) + 1;
            VersionConvenio::create([
                'convenio_id'              => $c->id,
                'numero_version'           => $next,
                'archivo_nombre_original'  => $name,
                'archivo_path'             => $path,
                'fecha_version'            => now(),
                'observaciones'            => 'Actualización',
                'created_at'               => now(),
            ]);
        }

        // Recalcular estado por fechas
        $this->setEstadoPorFechas($c);

        return response()->json($c, 200, [], JSON_UNESCAPED_UNICODE|JSON_INVALID_UTF8_SUBSTITUTE);
    }

    public function destroy($id)
    {
        DB::transaction(function () use ($id) {
            $c = Convenio::findOrFail($id);
            // Borrar archivos del convenio
            if ($c->archivo_path) Storage::delete($c->archivo_path);
            // Borrar versiones y sus archivos
            foreach ($c->versiones as $v) {
                if ($v->archivo_path) Storage::delete($v->archivo_path);
                $v->delete();
            }
            $c->delete();
        });

        return response()->json(['ok'=>true]);
    }

    /* -------- archivos por convenio -------- */

    public function uploadArchivo(Request $r, $id)
    {
        $c = Convenio::findOrFail($id);
        $r->validate(['archivo'=>'required|file|mimes:pdf,docx|max:20480']);

        $file = $r->file('archivo');
        $name = $this->toUtf8($file->getClientOriginalName());
        $path = Storage::putFileAs("convenios/{$c->id}", $file, $name);

        $c->archivo_nombre_original = $name;
        $c->archivo_path = $path;

        // Si estaba en BORRADOR => NEGOCIACION
        if ($c->estado === 'BORRADOR') {
            $c->estado = 'NEGOCIACION';
        }
        $c->save();

        // Si no hay V1, crearla como "Archivo inicial". Si ya hay, crear la siguiente.
        $max = (int) VersionConvenio::where('convenio_id', $c->id)->max('numero_version');
        if ($max === 0) {
            $this->crearVersionInicial($c, $path, $name);
        } else {
            VersionConvenio::create([
                'convenio_id'              => $c->id,
                'numero_version'           => $max + 1,
                'archivo_nombre_original'  => $name,
                'archivo_path'             => $path,
                'fecha_version'            => now(),
                'observaciones'            => 'Actualización',
                'created_at'               => now(),
            ]);
        }

        // Recalcular estado por fechas
        $this->setEstadoPorFechas($c);

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
        // Si quitó archivo y no está cerrado ni vencido => pasar a BORRADOR
        if (!in_array($c->estado, ['CERRADO','VENCIDO'])) {
            $c->estado = 'BORRADOR';
        }
        $c->save();
        return response()->json(['ok'=>true]);
    }

    /* -------- mantenimiento silencioso -------- */

    /** Pone en VENCIDO los convenios cuya fecha ya pasó (no CERRADO). */
    private function refreshEstadosVencidosSilencioso(): void
    {
        $hoy = Carbon::today(config('app.timezone'))->toDateString();
        Convenio::whereNotNull('fecha_vencimiento')
            ->where('estado','!=','CERRADO')
            ->whereDate('fecha_vencimiento','<',$hoy)
            ->update(['estado'=>'VENCIDO']);
    }
}