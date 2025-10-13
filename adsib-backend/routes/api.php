<?php

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

use App\Http\Controllers\AuthController;
use App\Http\Controllers\DashboardController;
use App\Http\Controllers\NotificationsController;
use App\Http\Controllers\ConvenioController;
use App\Http\Controllers\VersionController;
use App\Http\Controllers\UsuarioController;

use App\Http\Controllers\AnalisisController;
use App\Http\Controllers\RiesgosController;

/* -------------------- Públicas -------------------- */
Route::get('/ping', fn () => response()->json(['ok' => true, 'service' => 'LARAVEL10']));
Route::post('/auth/login', [AuthController::class, 'login']);

/* --------------- Protegidas (auth) --------------- */
Route::middleware('auth:sanctum')->group(function () {

    /* Auth */
    Route::get('/auth/me',      [AuthController::class, 'me']);
    Route::post('/auth/logout', [AuthController::class, 'logout']);

    /* Dashboard */
    Route::get('/dashboard/overview', [DashboardController::class, 'overview']);
    Route::get('/dashboard/resumen',  [DashboardController::class, 'resumen']);

    /* Notificaciones */
    Route::get   ('/notificaciones',               [NotificationsController::class, 'index']);
    Route::get   ('/notificaciones/alertas',       [NotificationsController::class, 'alerts']); // ← NUEVO (ALTO/MEDIO)
    Route::patch ('/notificaciones/{id}/leer',     [NotificationsController::class, 'markRead']);
    Route::patch ('/notificaciones/leer-todas',    [NotificationsController::class, 'markAllRead']);
    Route::delete('/notificaciones/{id}',          [NotificationsController::class, 'destroy']);
    Route::get   ('/notificaciones/vencidos',      [NotificationsController::class, 'vencidos']);
    Route::post  ('/notificaciones/refresh-expirations', [NotificationsController::class, 'refreshExpirations']);

    /* Usuarios (CRUD) */
    Route::apiResource('usuarios', UsuarioController::class)
        ->parameters(['usuarios' => 'id']);

    /* Convenios */
    Route::get   ('/convenios',        [ConvenioController::class, 'index']);
    Route::post  ('/convenios',        [ConvenioController::class, 'store']);
    Route::get   ('/convenios/{id}',   [ConvenioController::class, 'show']);
    Route::put   ('/convenios/{id}',   [ConvenioController::class, 'update']);
    Route::delete('/convenios/{id}',   [ConvenioController::class, 'destroy']);

    // Archivos de convenio
    Route::post  ('/convenios/{id}/archivo',           [ConvenioController::class, 'uploadArchivo']);
    Route::get   ('/convenios/{id}/archivo/descargar', [ConvenioController::class, 'descargarArchivo']);
    Route::delete('/convenios/{id}/archivo',           [ConvenioController::class, 'eliminarArchivo']);

    /* Versiones */
    Route::get   ('/convenios/{id}/versiones',  [VersionController::class, 'index']);
    Route::post  ('/convenios/{id}/versiones',  [VersionController::class, 'store']);
    Route::get   ('/versiones/{vid}/descargar', [VersionController::class, 'download']);
    Route::delete('/versiones/{vid}',           [VersionController::class, 'destroy']);
    Route::get   ('/versiones/{vid}/texto',     [VersionController::class, 'text']);

    /* Análisis de riesgo */
    Route::post('/analisis/riesgo',    [AnalisisController::class, 'riesgo']); // ejecutar
    Route::get ('/analisis',           [AnalisisController::class, 'index']);  // historial por versión
    Route::get ('/analisis/dataset',   [RiesgosController::class, 'dataset']); // dataset por versión
});

/* Utilitario */
Route::middleware('auth:sanctum')->get('/user', function (Request $request) {
    return $request->user();
});