<?php
namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class VersionConvenio extends Model
{
    protected $table = 'versiones_convenio';
    public $timestamps = false; // la tabla solo tiene created_at
    protected $fillable = [
        'convenio_id',
        'numero_version',
        'archivo_nombre_original',
        'archivo_path',
        'fecha_version',
        'observaciones',
        'created_at',
    ];
}