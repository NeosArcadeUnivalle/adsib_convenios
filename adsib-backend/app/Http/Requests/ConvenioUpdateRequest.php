<?php
namespace App\Http\Requests;
use Illuminate\Foundation\Http\FormRequest;

class ConvenioUpdateRequest extends FormRequest
{
    public function authorize(): bool { return true; }

    protected function prepareForValidation(): void
    {
        $this->merge([
            'titulo'        => $this->titulo !== null ? trim($this->titulo) : null,
            'descripcion'   => $this->descripcion ?? null,
        ]);
    }

    public function rules(): array
    {
        return [
            'titulo'            => ['sometimes','required','string','min:3','max:200','regex:/^[\pL\pN\pM\s\-\_\.\,:\(\)\/]+$/u'],
            'descripcion'       => ['nullable','string','max:4000'],
            'estado'            => ['nullable','in:BORRADOR,NEGOCIACION,VIGENTE,SUSPENDIDO,VENCIDO,RESCINDIDO,CERRADO'],
            'fecha_firma'       => ['nullable','date'],
            'fecha_vencimiento' => ['nullable','date','after_or_equal:fecha_firma'],
            'creado_por'        => ['nullable','integer'],
            'archivo'           => ['nullable','file','mimes:pdf,docx','max:20480'],
        ];
    }
}