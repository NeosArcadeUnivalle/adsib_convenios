<?php
namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Convenio extends Model
{
    protected $table = 'convenios';
    protected $fillable = [
        'titulo','descripcion','archivo_nombre_original','archivo_path',
        'fecha_firma','fecha_vencimiento','creado_por'
    ];
}