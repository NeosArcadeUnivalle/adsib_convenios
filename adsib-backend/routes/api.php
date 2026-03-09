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
use App\Http\Controllers\RiesgoKeywordsController;
use App\Http\Controllers\AssistantController;

/* -------------------- Públicas -------------------- */
Route::get('/ping', fn () => response()->json(['ok' => true, 'service' => 'LARAVEL10']));
Route::post('/auth/login',  [AuthController::class, 'login']);
Route::post('/auth/forgot', [AuthController::class, 'forgot']);

/* --------------- Protegidas (auth) --------------- */
Route::middleware('auth:sanctum')->group(function () {

    /* Auth */
    Route::get ('/auth/me',     [AuthController::class, 'me']);
    Route::post('/auth/logout', [AuthController::class, 'logout']);

    /* Dashboard */
    Route::get('/dashboard/overview', [DashboardController::class, 'overview']);
    Route::get('/dashboard/resumen',  [DashboardController::class, 'resumen']);

    /* Notificaciones */
    Route::get   ('/notificaciones',                 [NotificationsController::class, 'index']);
    Route::get   ('/notificaciones/alertas',         [NotificationsController::class, 'alerts']);
    Route::delete('/notificaciones/{id}',            [NotificationsController::class, 'destroy']);
    Route::get   ('/notificaciones/vencidos',        [NotificationsController::class, 'vencidos']);
    Route::post  ('/notificaciones/refresh-expirations', [NotificationsController::class, 'refreshExpirations'])
        ->name('notificaciones.refresh-expirations');

    /* Usuarios (CRUD) */
    Route::apiResource('usuarios', UsuarioController::class)
        ->parameters(['usuarios' => 'id']);

    /* Convenios */
    Route::get   ('/convenios',      [ConvenioController::class, 'index']);
    Route::post  ('/convenios',      [ConvenioController::class, 'store']);
    Route::get   ('/convenios/{id}', [ConvenioController::class, 'show']);
    Route::put   ('/convenios/{id}', [ConvenioController::class, 'update']);
    Route::delete('/convenios/{id}', [ConvenioController::class, 'destroy']);

    /* Archivos base del convenio (v1) */
    Route::post  ('/convenios/{id}/archivo',           [ConvenioController::class, 'uploadArchivo']);
Route::get   ('/convenios/{id}/archivo/descargar', [ConvenioController::class, 'descargarArchivo']);
Route::get   ('/convenios/{id}/archivo/ver',       [ConvenioController::class, 'verArchivo']);
    Route::delete('/convenios/{id}/archivo',           [ConvenioController::class, 'eliminarArchivo']);

    /* Archivo FINAL */
    Route::post ('/convenios/{id}/archivo-final',           [ConvenioController::class, 'uploadArchivoFinal']);
    Route::get  ('/convenios/{id}/archivo-final/descargar', [ConvenioController::class, 'descargarArchivoFinal']);
    Route::post ('/convenios/{id}/reabrir', [ConvenioController::class, 'reabrir']);
    Route::patch('/convenios/{id}/estado',  [ConvenioController::class, 'patchEstado']);

    /* Versiones */
    Route::get   ('/convenios/{id}/versiones',  [VersionController::class, 'index']);
    Route::post  ('/convenios/{id}/versiones',  [VersionController::class, 'store']);
    Route::get   ('/versiones/{vid}/descargar', [VersionController::class, 'download']);
    Route::delete('/versiones/{vid}',           [VersionController::class, 'destroy']);
    Route::get   ('/versiones/{vid}/texto',     [VersionController::class, 'text']);

    /* Análisis de riesgo */
    Route::post('/analisis/riesgo',   [AnalisisController::class, 'riesgo']);  // ejecutar análisis
    Route::get ('/analisis',          [AnalisisController::class, 'index']);   // historial por convenio
    Route::get ('/analisis/dataset',  [RiesgosController::class, 'dataset']);  // dataset por versión
    Route::get ('/analisis/{id}/pdf', [AnalisisController::class, 'pdf'])->whereNumber('id');

    /* Términos de riesgo (diccionario) */
    Route::get   ('/riesgos/keywords/known-tokens', [RiesgoKeywordsController::class, 'knownTokens']);
    Route::get   ('/riesgos/keywords',        [RiesgoKeywordsController::class, 'index']);
    Route::post  ('/riesgos/keywords',        [RiesgoKeywordsController::class, 'store']);
    Route::put   ('/riesgos/keywords/{id}',   [RiesgoKeywordsController::class, 'update'])->whereNumber('id');
    Route::patch ('/riesgos/keywords/{id}',   [RiesgoKeywordsController::class, 'update'])->whereNumber('id');
    Route::delete('/riesgos/keywords/{id}',   [RiesgoKeywordsController::class, 'destroy'])->whereNumber('id');

    /* Asistente Virtual */
    Route::post('/assistant/chat',    [AssistantController::class, 'chat']);
    Route::post('/assistant/reindex', [AssistantController::class, 'reindex']);
});

/* Utilitario */
Route::middleware('auth:sanctum')->get('/user', function (Request $request) {
    return $request->user();
});
