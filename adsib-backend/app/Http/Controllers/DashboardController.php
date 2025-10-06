<?php

namespace App\Http\Controllers;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Http\Request;
use App\Models\Notificacion;
use App\Models\Convenio;
use Carbon\Carbon;

class DashboardController extends Controller
{
    /** Hoy (sin horas) en la zona horaria de la app */
    private function todayLocal(): string
    {
        return Carbon::today(config('app.timezone'))->toDateString();
    }

    /**
     * Cuenta convenios vencidos **exactamente como en la UI**:
     *  - fecha_vencimiento <= hoy
     *  - excluye NULL
     * Soporta distintos motores:
     *  - MySQL/MariaDB/pgsql: whereDate(...)
     *  - Otros (sqlite/strings): comparación directa YYYY-MM-DD
     */
    private function countVencidos(): int
    {
        $hoy    = $this->todayLocal();
        $driver = DB::connection()->getDriverName();

        $q = Convenio::query()->whereNotNull('fecha_vencimiento');

        if (in_array($driver, ['mysql', 'pgsql'])) {
            $q->whereDate('fecha_vencimiento', '<=', $hoy);
        } else {
            // Fallback genérico (la columna suele estar en formato ISO)
            $q->where('fecha_vencimiento', '<=', $hoy);
        }

        return (int) $q->count();
    }

    /** Cuenta notificaciones no leídas (acepta 'leido' o 'leida') */
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
        if (class_exists(\App\Models\Notificacion::class)) {
            return (int) Notificacion::where('leido', false)
                    ->orWhere('leida', false)->count();
        }
        return 0;
    }

    /** Resumen “rápido” (si ya lo usabas) */
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

    /** Resumen para el popup (usado por el frontend) */
    public function overview(Request $r)
    {
        $notificaciones = $this->countNotificaciones();
        $vencidos       = $this->countVencidos();

        // Riesgos si guardas 'analisis_riesgos' o 'riesgo_nivel' en convenios
        $riesgoAlto  = 0;
        $riesgoMedio = 0;

        if (Schema::hasTable('analisis_riesgos')) {
            $sub = DB::table('analisis_riesgos')
                ->select('convenio_id', DB::raw('MAX(created_at) as mc'))
                ->groupBy('convenio_id');

            $latest = DB::table('analisis_riesgos as ar')
                ->joinSub($sub, 's', function ($j) {
                    $j->on('ar.convenio_id', '=', 's.convenio_id')
                      ->on('ar.created_at', '=', 's.mc');
                })
                ->select('ar.risk_level');

            $riesgoAlto  = (int) DB::query()->fromSub($latest, 't')->where('risk_level', 'ALTO')->count();
            $riesgoMedio = (int) DB::query()->fromSub($latest, 't')->where('risk_level', 'MEDIO')->count();
        } elseif (Schema::hasColumn('convenios', 'riesgo_nivel')) {
            $riesgoAlto  = (int) DB::table('convenios')->where('riesgo_nivel', 'ALTO')->count();
            $riesgoMedio = (int) DB::table('convenios')->where('riesgo_nivel', 'MEDIO')->count();
        }

        return response()->json([
            'notificaciones'     => $notificaciones,
            'convenios_vencidos' => $vencidos,
            'riesgo_alto'        => $riesgoAlto,
            'riesgo_medio'       => $riesgoMedio,
        ], 200, [], JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
    }
}