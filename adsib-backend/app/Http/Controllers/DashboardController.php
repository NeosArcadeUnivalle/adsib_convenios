<?php
 
namespace App\Http\Controllers;
 
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Http\Request;
use App\Models\Convenio;
use Carbon\Carbon;
 
class DashboardController extends Controller
{
    /** Hoy (sin horas) en la zona horaria de la app */
    private function todayLocal(): string
    {
        return Carbon::today(config('app.timezone'))->toDateString();
    }
 
    private function countVencidos(): int
    {
        $hoy    = $this->todayLocal();
        $driver = DB::connection()->getDriverName();
 
        $q = Convenio::query()->whereNotNull('fecha_vencimiento');
        if (in_array($driver, ['mysql', 'pgsql'])) {
            $q->whereDate('fecha_vencimiento', '<=', $hoy);
        } else {
            $q->where('fecha_vencimiento', '<=', $hoy);
        }
        return (int) $q->count();
    }
 
    private function countNotificaciones(): int
    {
        if (Schema::hasTable('notificaciones')) {
            $q = DB::table('notificaciones');
            if (Schema::hasColumn('notificaciones', 'leido')) {
                $q->where('leido', 0);
            } elseif (Schema::hasColumn('notificaciones', 'leida')) {
                $q->where('leida', 0);
            }
            return (int) $q->count();
        }
        return 0;
    }
 
    public function resumen(Request $r)
    {
        $hoy       = $this->todayLocal();
        $noti      = $this->countNotificaciones();
        $vencidos  = $this->countVencidos();
        $prox30    = (int) Convenio::whereNotNull('fecha_vencimiento')
                        ->whereDate('fecha_vencimiento', '>=', $hoy)
                        ->whereDate('fecha_vencimiento', '<=', Carbon::parse($hoy)->addDays(30)->toDateString())
                        ->count();
 
        return response()->json([
            'notificaciones_no_leidas' => $noti,
            'convenios_vencidos'       => $vencidos,
            'convenios_prox_30'        => $prox30,
            'hoy'                       => $hoy,
        ]);
    }
 
    /** Resumen para el popup y para el badge lateral */
    public function overview(Request $r)
    {
        $hoy = $this->todayLocal();
        $d30 = Carbon::parse($hoy)->addDays(30)->toDateString();
        $d31 = Carbon::parse($hoy)->addDays(31)->toDateString();
        $d90 = Carbon::parse($hoy)->addDays(90)->toDateString();
 
        // --- Convenios por vencimiento ---
        $expHighIds = Convenio::query()
            ->whereNotNull('fecha_vencimiento')
            ->whereDate('fecha_vencimiento', '<=', $d30)   // incluye vencidos
            ->pluck('id')->all();
 
        $expMediumIds = Convenio::query()
            ->whereNotNull('fecha_vencimiento')
            ->whereDate('fecha_vencimiento', '>=', $d31)
            ->whereDate('fecha_vencimiento', '<=', $d90)
            ->pluck('id')->all();
 
        // --- Último análisis por convenio ---
        $riskHighIds = [];
        $riskMediumIds = [];
 
        if (Schema::hasTable('analisis_riesgos')) {
            $sub = DB::table('analisis_riesgos')
                ->select('convenio_id', DB::raw('MAX(created_at) as mc'))
                ->groupBy('convenio_id');
 
            $latest = DB::table('analisis_riesgos as ar')
                ->joinSub($sub, 's', function ($j) {
                    $j->on('ar.convenio_id', '=', 's.convenio_id')
                      ->on('ar.created_at', '=', 's.mc');
                })
                ->select('ar.convenio_id', 'ar.risk_level');
 
            $riskHighIds  = DB::query()->fromSub($latest, 't')
                ->where('risk_level', 'ALTO')->pluck('convenio_id')->all();
 
            $riskMediumIds = DB::query()->fromSub($latest, 't')
                ->where('risk_level', 'MEDIO')->pluck('convenio_id')->all();
        } elseif (Schema::hasColumn('convenios', 'riesgo_nivel')) {
            $riskHighIds  = DB::table('convenios')->where('riesgo_nivel', 'ALTO')->pluck('id')->all();
            $riskMediumIds = DB::table('convenios')->where('riesgo_nivel', 'MEDIO')->pluck('id')->all();
        }
 
        // --- Combinar sin duplicados y con precedencia ALTO ---
        $highSet = collect($expHighIds)->merge($riskHighIds)->unique()->values();
        $mediumSet = collect($expMediumIds)->merge($riskMediumIds)
            ->diff($highSet) // quitar los que ya son alto
            ->unique()->values();
 
        $highCount  = $highSet->count();
        $mediumCount = $mediumSet->count();
 
        // Este número alimenta el badge del menú
        $totalAlertas = $highCount + $mediumCount;
 
        // Métricas adicionales que ya usabas
        $vencidos = $this->countVencidos();
 
        return response()->json([
            'notificaciones'     => $totalAlertas, // <-- ahora coincide con la pantalla
            'convenios_vencidos' => $vencidos,
            'riesgo_alto'        => $highCount,
            'riesgo_medio'       => $mediumCount,
        ], 200, [], JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
    }
}