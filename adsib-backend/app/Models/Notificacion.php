<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Notificacion extends Model
{
    protected $table = 'notificaciones';
    public $timestamps = false;

    protected $fillable = [
        'convenio_id',
        'tipo',          // 'VENCIMIENTO','RENOVACION','RIESGO','SEGUIMIENTO'...
        'mensaje',
        'leido',         // boolean
        'fecha_envio',   // datetime/timestamp
    ];

    protected $casts = [
        'leido'       => 'boolean',
        'fecha_envio' => 'datetime',
    ];

    public function convenio()
    {
        return $this->belongsTo(Convenio::class, 'convenio_id');
    }
}