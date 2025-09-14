<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use App\Models\Notificacion;
use App\Models\Convenio;
use Carbon\Carbon;

class DashboardController extends Controller
{
    public function resumen(Request $r)
    {
        // “Hoy” sin horas, con tz de la app (config/app.php → timezone)
        $today = Carbon::today();

        $noti = Notificacion::where('leido', false)->count();

        $vencidos = Convenio::whereDate('fecha_vencimiento', '<=', $today->toDateString())->count();

        $prox30 = Convenio::whereDate('fecha_vencimiento', '>=', $today->toDateString())
                          ->whereDate('fecha_vencimiento', '<=', $today->copy()->addDays(30)->toDateString())
                          ->count();

        return response()->json([
            'notificaciones_no_leidas' => $noti,
            'convenios_vencidos'       => $vencidos,
            'convenios_prox_30'        => $prox30,
            'hoy'                       => $today->toDateString(),
        ]);
    }
}