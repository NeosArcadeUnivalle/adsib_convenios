<?php
namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Comparacion extends Model
{
    protected $table = 'comparaciones';
    public $timestamps = false; // solo created_at
    protected $fillable = [
        'version_base_id',
        'version_comparada_id',
        'diferencias_detectadas',
        'resumen_cambios',
        'created_at',
    ];

    protected $casts = [
        'diferencias_detectadas' => 'array',
    ];
}