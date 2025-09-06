<?php

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use App\Http\Controllers\ConvenioController;

Route::get('/ping', fn() => response()->json(['ok'=>true]));

/* CRUD convenios */
Route::get   ('/convenios',      [ConvenioController::class,'index']);
Route::post  ('/convenios',      [ConvenioController::class,'store']);
Route::get   ('/convenios/{id}', [ConvenioController::class,'show']);
Route::put   ('/convenios/{id}', [ConvenioController::class,'update']);
Route::delete('/convenios/{id}', [ConvenioController::class,'destroy']);

/* archivo por convenio */
Route::post  ('/convenios/{id}/archivo',            [ConvenioController::class,'uploadArchivo']);
Route::get   ('/convenios/{id}/archivo/descargar',  [ConvenioController::class,'descargarArchivo']);
Route::delete('/convenios/{id}/archivo',            [ConvenioController::class,'eliminarArchivo']);

Route::get('/ping', fn () => response()->json(['ok' => true, 'service' => 'LARAVEL10']));

Route::middleware('auth:sanctum')->get('/user', function (Request $request) {
    return $request->user();
});