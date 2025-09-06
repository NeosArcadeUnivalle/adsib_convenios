<?php

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use App\Http\Controllers\AuthController;
use App\Http\Controllers\ConvenioController;
use App\Http\Controllers\VersionController;

/* Auth pública */
Route::post('/auth/login',  [AuthController::class, 'login']);

/* Rutas protegidas */
Route::middleware('auth:sanctum')->group(function () {
    Route::get('/auth/me',     [AuthController::class, 'me']);
    Route::post('/auth/logout',[AuthController::class, 'logout']);

    // CRUD convenios (usa tus controladores ya hechos)
    Route::get   ('/convenios',      [ConvenioController::class, 'index']);
    Route::post  ('/convenios',      [ConvenioController::class, 'store']);
    Route::get   ('/convenios/{id}', [ConvenioController::class, 'show']);
    Route::put   ('/convenios/{id}', [ConvenioController::class, 'update']);
    Route::delete('/convenios/{id}', [ConvenioController::class, 'destroy']);

    // archivo base del convenio
    Route::post  ('/convenios/{id}/archivo',            [ConvenioController::class,'uploadArchivo']);
    Route::get   ('/convenios/{id}/archivo/descargar',  [ConvenioController::class,'descargarArchivo']);
    Route::delete('/convenios/{id}/archivo',            [ConvenioController::class,'eliminarArchivo']);

    // Versiones
    Route::get   ('/convenios/{id}/versiones',  [VersionController::class,'index']);
    Route::post  ('/convenios/{id}/versiones',  [VersionController::class,'store']);
    Route::get   ('/versiones/{vid}/descargar', [VersionController::class,'download']);
    Route::delete('/versiones/{vid}',           [VersionController::class,'destroy']);
    Route::get   ('/versiones/{vid}/texto',     [VersionController::class,'text']);
});

Route::get('/ping', fn () => response()->json(['ok' => true, 'service' => 'LARAVEL10']));

Route::middleware('auth:sanctum')->get('/user', function (Request $request) {
    return $request->user();
});