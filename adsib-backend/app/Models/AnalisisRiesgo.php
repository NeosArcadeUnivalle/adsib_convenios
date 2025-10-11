<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class AnalisisRiesgo extends Model
{
    // nombre de tabla explícito por si tu convención es distinta
    protected $table = 'analisis_riesgos';

    protected $fillable = [
        'convenio_id',
        'version_id',
        'risk_level',   // ALTO | MEDIO | BAJO
        'score',        // 0..1
        'matches',      // cantidad de hallazgos
        'modelo',       // p.ej. 'tfidf-pipeline' o 'semantic'
        'analizado_en', // datetime
    ];

    protected $casts = [
        'convenio_id'  => 'integer',
        'version_id'   => 'integer',
        'score'        => 'float',
        'matches'      => 'integer',
        'analizado_en' => 'datetime',
        'created_at'   => 'datetime',
        'updated_at'   => 'datetime',
    ];

    // Relaciones opcionales (solo si tienes estos modelos)
    public function convenio() { return $this->belongsTo(\App\Models\Convenio::class, 'convenio_id'); }
    public function version()  { return $this->belongsTo(\App\Models\VersionConvenio::class,  'version_id'); }
}