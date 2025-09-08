<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Convenio extends Model
{
    protected $table = 'convenios';

    // 👇 incluye todos los campos que actualizas por create()/update()
    protected $fillable = [
        'titulo',
        'descripcion',
        'estado',                 // <-- IMPORTANTE
        'fecha_firma',
        'fecha_vencimiento',
        'creado_por',
        'archivo_nombre_original',
        'archivo_path',
    ];

    protected $casts = [
        'fecha_firma'       => 'date',
        'fecha_vencimiento' => 'date',
    ];
}