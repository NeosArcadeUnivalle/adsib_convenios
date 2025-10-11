<?php

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

use App\Http\Controllers\AuthController;
use App\Http\Controllers\DashboardController;
use App\Http\Controllers\NotificationsController;
use App\Http\Controllers\ConvenioController;
use App\Http\Controllers\VersionController;
use App\Http\Controllers\UsuarioController;

use App\Http\Controllers\AnalisisController;      // ← tu controlador v1
use App\Http\Controllers\RiesgosController;       // ← dataset del análisis

/* ===================== Públicas ===================== */

// Salud / ping del API
Route::get('/ping', fn () => response()->json(['ok' => true, 'service' => 'LARAVEL10']));

// Autenticación (login)
Route::post('/auth/login', [AuthController::class, 'login']);


/* ================ Protegidas (auth:sanctum) ================ */

Route::middleware('auth:sanctum')->group(function () {

    // Perfil autenticado
    Route::get('/auth/me',      [AuthController::class, 'me']);
    Route::post('/auth/logout', [AuthController::class, 'logout']);

    /* --------- Dashboard --------- */
    Route::get('/dashboard/overview', [DashboardController::class, 'overview']);
    Route::get('/dashboard/resumen',  [DashboardController::class, 'resumen']);

    /* --------- Notificaciones --------- */
    Route::get   ('/notificaciones',               [NotificationsController::class, 'index']);
    Route::patch ('/notificaciones/{id}/leer',     [NotificationsController::class, 'markRead']);
    Route::patch ('/notificaciones/leer-todas',    [NotificationsController::class, 'markAllRead']);
    Route::delete('/notificaciones/{id}',          [NotificationsController::class, 'destroy']);
    Route::get   ('/notificaciones/vencidos',      [NotificationsController::class, 'vencidos']);

    /* --------- Usuarios (si usas este CRUD) --------- */
    Route::apiResource('usuarios', UsuarioController::class)->parameters([
        'usuarios' => 'id'
    ]);

    /* --------- Convenios --------- */
    Route::get   ('/convenios',        [ConvenioController::class, 'index']);
    Route::post  ('/convenios',        [ConvenioController::class, 'store']);
    Route::get   ('/convenios/{id}',   [ConvenioController::class, 'show']);
    Route::put   ('/convenios/{id}',   [ConvenioController::class, 'update']);
    Route::delete('/convenios/{id}',   [ConvenioController::class, 'destroy']);

    // Archivo base del convenio
    Route::post  ('/convenios/{id}/archivo',           [ConvenioController::class, 'uploadArchivo']);
    Route::get   ('/convenios/{id}/archivo/descargar', [ConvenioController::class, 'descargarArchivo']);
    Route::delete('/convenios/{id}/archivo',           [ConvenioController::class, 'eliminarArchivo']);

    /* --------- Versiones de convenio --------- */
    Route::get   ('/convenios/{id}/versiones',  [VersionController::class, 'index']);
    Route::post  ('/convenios/{id}/versiones',  [VersionController::class, 'store']);
    Route::get   ('/versiones/{vid}/descargar', [VersionController::class, 'download']);
    Route::delete('/versiones/{vid}',           [VersionController::class, 'destroy']);
    Route::get   ('/versiones/{vid}/texto',     [VersionController::class, 'text']);

    /* --------- Análisis de riesgo (NLP) --------- */
    // Ejecutar análisis
    Route::post('/analisis/riesgo', [AnalisisController::class, 'riesgo']);

    // Historial de análisis (tabla analisis_riesgos) por versión
    Route::get('/analisis', [AnalisisController::class, 'index']); // ?version_id=XX&page=1&per=10

    // Dataset detallado (tabla riesgo_dataset) por versión
    Route::get('/analisis/dataset', [RiesgosController::class, 'dataset']); // ?version_id=XX&page=1&per=20
});


/* Ruta utilitaria para ver el usuario autenticado (si la necesitas) */
Route::middleware('auth:sanctum')->get('/user', function (Request $request) {
    return $request->user();
});