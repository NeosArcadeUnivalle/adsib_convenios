<?php
 
namespace App\Models;
 
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;
 
class Convenio extends Model
{
    protected $table = 'convenios';
 
    protected $fillable = [
        'titulo',
        'descripcion',
        'archivo_nombre_original',
        'archivo_path',
        'fecha_firma',
        'fecha_vencimiento',
        'creado_por',
        'estado', // se recalcula automáticamente, pero se mantiene fillable por compatibilidad
    ];
 
    protected $casts = [
        'fecha_firma'       => 'date',
        'fecha_vencimiento' => 'date',
    ];
 
    public const EST_BORRADOR    = 'BORRADOR';
    public const EST_NEGOCIACION = 'NEGOCIACION';
    public const EST_CERRADO     = 'CERRADO';
    public const EST_VENCIDO     = 'VENCIDO';
 
    public function versiones(): HasMany
    {
        // orden natural ascendente (v1, v2, v3…)
        return $this->hasMany(VersionConvenio::class, 'convenio_id')
                    ->orderBy('numero_version', 'asc');
    }
 
    public function ultimaVersion(): ?VersionConvenio
    {
        return $this->hasMany(VersionConvenio::class, 'convenio_id')
                    ->orderByDesc('numero_version')
                    ->first();
    }
 
    public function isPastVencimiento(): bool
    {
        if (!$this->fecha_vencimiento) return false;
        $today = Carbon::today(config('app.timezone'));
        return $this->fecha_vencimiento->lt($today);
    }
 
    /**
     * Recalcula y persiste el estado:
     * - Si estaba CERRADO y ya venció ⇒ VENCIDO.
     * - Si tiene archivo final (última versión) y no venció ⇒ CERRADO.
     * - Si tiene base/alguna versión ⇒ NEGOCIACION.
     * - Sin archivos ⇒ BORRADOR.
     */
    public function recomputeEstado(bool $save = true): string
    {
        if ($this->estado === self::EST_CERRADO && $this->isPastVencimiento()) {
            $this->estado = self::EST_VENCIDO;
        } else {
            if ($this->estado === self::EST_CERRADO) {
                $this->estado = $this->isPastVencimiento() ? self::EST_VENCIDO : self::EST_CERRADO;
            } else {
                $tieneBase    = !empty($this->archivo_path);
                $tieneVersion = $this->versiones()->exists();
                $this->estado = ($tieneBase || $tieneVersion) ? self::EST_NEGOCIACION : self::EST_BORRADOR;
            }
        }
        if ($save) $this->save();
        return $this->estado;
    }
}