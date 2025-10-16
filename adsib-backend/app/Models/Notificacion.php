<?php
 
namespace App\Models;
 
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
 
class Notificacion extends Model
{
    protected $table = 'notificaciones';
 
    protected $fillable = [
        'convenio_id',
        'tipo',       // ALTO_RIESGO | MEDIO_RIESGO
        'mensaje',
        'leido',
        'fecha_envio',
        'acciones',   // JSON string
    ];
 
    protected $casts = [
        'leido'       => 'boolean',
        'fecha_envio' => 'datetime',
    ];
 
    public function convenio(): BelongsTo
    {
        return $this->belongsTo(Convenio::class, 'convenio_id');
    }
}