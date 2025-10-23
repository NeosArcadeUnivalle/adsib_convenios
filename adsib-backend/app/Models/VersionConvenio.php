<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class VersionConvenio extends Model
{
    protected $table = 'versiones_convenio';

    protected $fillable = [
        'convenio_id',
        'numero_version',
        'archivo_nombre_original',
        'archivo_path',
        'fecha_version',
        'observaciones',
        'texto', 
    ];

    protected $casts = [
        'fecha_version' => 'datetime',
    ];

    public $timestamps = true;
    const UPDATED_AT = null; // tu tabla solo tiene created_at

    public function convenio(): BelongsTo
    {
        return $this->belongsTo(Convenio::class, 'convenio_id');
    }
}