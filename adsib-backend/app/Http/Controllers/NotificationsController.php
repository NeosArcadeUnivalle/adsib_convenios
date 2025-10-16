<?php
 
namespace App\Http\Controllers;
 
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use App\Models\Notificacion;
use App\Models\Convenio;
use Carbon\Carbon;
 
class NotificationsController extends Controller
{
    /** Listado paginado genérico de notificaciones (CRUD) */
    public function index(Request $r)
    {
        $per = (int) $r->get('per_page', 10);
        $per = ($per > 0 && $per <= 100) ? $per : 10;
 
        $q = Notificacion::query()
            ->with(['convenio:id,titulo,fecha_vencimiento,estado'])
            ->when($r->filled('tipo'),   fn($qq) => $qq->where('tipo', $r->tipo))
            ->when($r->filled('leido'),  fn($qq) => $qq->where('leido', filter_var($r->leido, FILTER_VALIDATE_BOOLEAN)))
            ->when($r->filled('q'), function ($qq) use ($r) {
                $t = '%'.strtolower($r->q).'%';
                $qq->where(function ($w) use ($t) {
                    $w->whereRaw('LOWER(mensaje) LIKE ?', [$t]);
                });
            })
            ->orderByDesc('fecha_envio');
 
        return response()->json($q->paginate($per));
    }
 
    /** Mantengo por compatibilidad (el front ya no la usa para alertas) */
    public function markRead(Request $r, $id)
    {
        $n = Notificacion::findOrFail($id);
        $n->leido = (bool) $r->get('leido', true);
        $n->save();
        return response()->json($n);
    }
 
    /** Mantengo por compatibilidad (el front ya no la usa para alertas) */
    public function markAllRead()
    {
        Notificacion::where('leido', false)->update(['leido' => true]);
        return response()->json(['ok' => true]);
    }
 
    public function destroy($id)
    {
        $n = Notificacion::findOrFail($id);
        $n->delete();
        return response()->json(['ok' => true]);
    }
 
    /** Listado simple de vencidos (solo CERRADO/VENCIDO) */
    public function vencidos()
    {
        $hoy    = Carbon::today(config('app.timezone'))->toDateString();
        $driver = DB::connection()->getDriverName();
 
        $q = Convenio::select('id','titulo','estado','fecha_vencimiento')
            ->whereIn('estado', ['CERRADO','VENCIDO'])
            ->whereNotNull('fecha_vencimiento');
 
        if (in_array($driver, ['mysql','pgsql'])) {
            $q->whereDate('fecha_vencimiento', '<=', $hoy);
        } else {
            $q->where('fecha_vencimiento', '<=', $hoy);
        }
 
        $rows = $q->orderBy('fecha_vencimiento', 'asc')->get();
 
        // Auto-transición CERRADO -> VENCIDO si ya venció
        foreach ($rows as $c) {
            if ($c->estado === 'CERRADO') {
                $c->estado = 'VENCIDO';
                $c->save();
            }
        }
 
        return response()->json($rows, 200, [], JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
    }
 
    /**
     * ALERTAS (para la página de Notificaciones)
     * - ALTO: vencido/≤30d (solo CERRADO/VENCIDO) o análisis ALTO (solo NEGOCIACION)
     * - MEDIO: 31–90d (solo CERRADO/VENCIDO) o análisis MEDIO (solo NEGOCIACION)
     * Devuelve { high: [...], medium: [...], badge: N }
     */
    public function alerts()
    {
        $today = Carbon::today(config('app.timezone'));
 
        // ---- 1) VENCIMIENTOS (solo CERRADO / VENCIDO) ----
        $byConv = []; // convenio_id => item combinado
 
        $convs = Convenio::select('id','titulo','estado','fecha_vencimiento')
            ->whereIn('estado', ['CERRADO','VENCIDO'])
            ->whereNotNull('fecha_vencimiento')
            ->get();
 
        foreach ($convs as $c) {
            $fv = $c->fecha_vencimiento ? Carbon::parse($c->fecha_vencimiento) : null;
            if (!$fv) continue;
 
            $days = $today->diffInDays($fv, false); // negativo si ya venció
            $nivel = null;
 
            if ($days <= 30) {
                $nivel = 'ALTO';
            } elseif ($days <= 90) {
                $nivel = 'MEDIO';
            } else {
                continue; // > 90: fuera de alertas
            }
 
            // Auto-transición a VENCIDO si corresponde
            if ($days < 0 && $c->estado === 'CERRADO') {
                $c->estado = 'VENCIDO';
                $c->save();
            }
 
            $mensaje = ($days < 0)
                ? 'Convenio vencido.'
                : ($nivel === 'ALTO'
                    ? 'Vencimiento en ≤ 30 días'
                    : 'Vencimiento en 31–90 días');
 
            $row = [
                'id'               => null,
                'convenio_id'      => $c->id,
                'convenio_titulo'  => $c->titulo,
                'mensaje'          => $mensaje,
                'fecha_envio'      => now(),
                'created_at'       => now(),
                'estado'           => $c->estado,
                'motivos'          => ['vencimiento'],
                'nivel'            => $nivel,
                'dias'             => $days,
            ];
 
            $byConv[$c->id] = $this->mergeAlert($byConv[$c->id] ?? null, $row);
        }
 
        // ---- 2) RIESGO (solo NEGOCIACION, tomar la ÚLTIMA por convenio) ----
        $riesgo = Notificacion::query()
            ->whereIn('tipo', ['ALTO_RIESGO', 'MEDIO_RIESGO'])
            // ->where('leido', false)  // ← ya no dependemos de "leídas"
            ->with(['convenio:id,titulo,estado'])
            ->orderByDesc('fecha_envio')
            ->orderByDesc('created_at')
            ->get();
 
        $seen = []; // convenio_id => bool, para quedarnos con la última
        foreach ($riesgo as $n) {
            // Solo NEGOCIACION
            if (!$n->convenio || $n->convenio->estado !== 'NEGOCIACION') continue;
 
            if (isset($seen[$n->convenio_id])) continue; // ya tomamos la última de este convenio
            $seen[$n->convenio_id] = true;
 
            $nivel = str_starts_with($n->tipo, 'ALTO') ? 'ALTO' : 'MEDIO';
 
            $row = [
                'id'               => $n->id,
                'convenio_id'      => $n->convenio_id,
                'convenio_titulo'  => $n->convenio?->titulo ?? ("Convenio #".$n->convenio_id),
                'mensaje'          => $n->mensaje,
                'fecha_envio'      => $n->fecha_envio ?? $n->created_at,
                'created_at'       => $n->created_at,
                'estado'           => $n->convenio?->estado,
                'motivos'          => ['analisis'],
                'nivel'            => $nivel,
            ];
 
            $byConv[$n->convenio_id] = $this->mergeAlert($byConv[$n->convenio_id] ?? null, $row);
        }
 
        // ---- 3) Clasificar ----
        $high = [];
        $medium = [];
 
        foreach ($byConv as $item) {
            $nivel = $item['nivel'] ?? 'MEDIO';
            if ($nivel === 'ALTO') {
                $high[] = $item;
            } else {
                $medium[] = $item;
            }
        }
 
        // ordenar por fecha más reciente
        $orderFn = fn($a,$b) =>
            strtotime(($b['fecha_envio'] ?? $b['created_at'])) <=> strtotime(($a['fecha_envio'] ?? $a['created_at']));
 
        usort($high, $orderFn);
        usort($medium, $orderFn);
 
        // limpiar campo auxiliar 'nivel'
        $high   = array_map(function ($x) { unset($x['nivel']); return $x; }, $high);
        $medium = array_map(function ($x) { unset($x['nivel']); return $x; }, $medium);
 
        return response()->json([
            'high'   => $high,
            'medium' => $medium,
            'badge'  => count($high) + count($medium),
        ], 200, [], JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
    }
 
    /** Fusiona dos alertas del mismo convenio, priorizando ALTO y acumulando motivos. */
    private function mergeAlert(?array $a, array $b): array
    {
        if ($a === null) return $b;
 
        $lvlA = $a['nivel'] ?? 'MEDIO';
        $lvlB = $b['nivel'] ?? 'MEDIO';
 
        // toma el de mayor prioridad (ALTO sobre MEDIO)
        $out = ($lvlB === 'ALTO' && $lvlA !== 'ALTO') ? $b : $a;
 
        // motivos únicos
        $out['motivos'] = array_values(array_unique(array_merge($a['motivos'] ?? [], $b['motivos'] ?? [])));
 
        // fecha más reciente
        $fa = strtotime($a['fecha_envio'] ?? $a['created_at']);
        $fb = strtotime($b['fecha_envio'] ?? $b['created_at']);
        if ($fb > $fa) {
            $out['fecha_envio'] = $b['fecha_envio'] ?? $b['created_at'];
        }
 
        // estado si está disponible
        $out['estado'] = $a['estado'] ?? $b['estado'] ?? null;
 
        // nivel más alto
        $out['nivel'] = ($lvlA === 'ALTO' || $lvlB === 'ALTO') ? 'ALTO' : 'MEDIO';
 
        return $out;
    }
 
    /**
     * Refresca estados por vencimiento: CERRADO -> VENCIDO si ya pasó la fecha.
     * Útil para un CRON o para llamarlo manualmente desde el front.
     */
    public function refreshExpirations()
    {
        $today = Carbon::today(config('app.timezone'))->toDateString();
 
        $affected = Convenio::where('estado', 'CERRADO')
            ->whereNotNull('fecha_vencimiento')
            ->whereDate('fecha_vencimiento', '<', $today)
            ->update(['estado' => 'VENCIDO', 'updated_at' => now()]);
 
        return response()->json(['ok' => true, 'updated' => $affected]);
    }
}