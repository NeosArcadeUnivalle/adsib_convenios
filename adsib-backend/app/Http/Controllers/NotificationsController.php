<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use App\Models\Notificacion;
use App\Models\Convenio;
use Carbon\Carbon;

class NotificationsController extends Controller
{
    // Lista de notificaciones (con filtros) + convenio relacionado
    public function index(Request $r)
    {
        $per = (int) $r->get('per_page', 10);
        $per = ($per > 0 && $per <= 100) ? $per : 10;

        $q = Notificacion::query()
            ->with(['convenio:id,titulo,fecha_vencimiento'])
            ->when($r->filled('tipo'),      fn($qq)=>$qq->where('tipo', $r->tipo))
            ->when($r->filled('leido'),     fn($qq)=>$qq->where('leido', filter_var($r->leido, FILTER_VALIDATE_BOOLEAN)))
            ->when($r->filled('q'), function($qq) use ($r){
                $t = '%'.strtolower($r->q).'%';
                $qq->where(function($w) use ($t){
                    $w->whereRaw('LOWER(mensaje) LIKE ?', [$t]);
                });
            })
            ->orderByDesc('fecha_envio');

        return response()->json($q->paginate($per));
    }

    // Marcar como leído/no leído
    public function markRead(Request $r, $id)
    {
        $n = Notificacion::findOrFail($id);
        $n->leido = (bool) $r->get('leido', true);
        $n->save();
        return response()->json($n);
    }

    // Marcar todas como leídas
    public function markAllRead()
    {
        Notificacion::where('leido', false)->update(['leido' => true]);
        return response()->json(['ok'=>true]);
    }

    // Eliminar
    public function destroy($id)
    {
        $n = Notificacion::findOrFail($id);
        $n->delete();
        return response()->json(['ok'=>true]);
    }

    // Sección "Convenios vencidos" para la parte superior del apartado
    public function vencidos()
    {
        $today = Carbon::today()->toDateString();

        // Solo campos necesarios
        $rows = Convenio::select('id','titulo','estado','fecha_vencimiento')
            ->whereDate('fecha_vencimiento', '<=', $today)
            ->orderBy('fecha_vencimiento')
            ->get();

        return response()->json($rows);
    }
}