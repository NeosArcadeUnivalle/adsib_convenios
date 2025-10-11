<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class RiesgoDataset extends Model
{
    protected $table = 'riesgo_dataset';

    protected $fillable = [
        'convenio_id',
        'version_id',
        'page',
        'line',
        'start',
        'end',
        'text',       // fragmento o token detectado
        'label_json', // {severity, source, reason}
        'source',     // keyword | pattern | semantic
    ];

    protected $casts = [
        'convenio_id' => 'integer',
        'version_id'  => 'integer',
        'page'        => 'integer',
        'line'        => 'integer',
        'start'       => 'integer',
        'end'         => 'integer',
        'label_json'  => 'array',   // acceso como array en PHP
        'created_at'  => 'datetime',
        'updated_at'  => 'datetime',
    ];

    public function convenio() { return $this->belongsTo(\App\Models\Convenio::class, 'convenio_id'); }
    public function version()  { return $this->belongsTo(\App\Models\VersionConvenio::class,  'version_id'); }
}