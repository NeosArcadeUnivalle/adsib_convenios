<?php
namespace App\Http\Requests;
use Illuminate\Foundation\Http\FormRequest;

class ConvenioStoreRequest extends FormRequest
{
    public function authorize(): bool { return true; }

    protected function prepareForValidation(): void
    {
        $this->merge([
            'titulo'        => $this->titulo ? trim($this->titulo) : null,
            'descripcion'   => $this->descripcion ?? null,
        ]);
    }

    public function rules(): array
    {
        return [
            'titulo'            => ['required','string','min:3','max:200', 'regex:/^[\pL\pN\pM\s\-\_\.\,:\(\)\/]+$/u'],
            'descripcion'       => ['nullable','string','max:4000'],
            'fecha_firma'       => ['nullable','date'],
            'fecha_vencimiento' => ['nullable','date','after_or_equal:fecha_firma'],
            'creado_por'        => ['nullable','integer'],
            'archivo'           => ['nullable','file','mimes:pdf,docx','max:20480'],
        ];
    }

    public function messages(): array
    {
        return [
            'titulo.required' => 'El título es obligatorio.',
            'titulo.min'      => 'El título debe tener al menos 3 caracteres.',
            'titulo.max'      => 'El título no debe superar 200 caracteres.',
            'titulo.regex'    => 'El título contiene caracteres no permitidos.',
            'descripcion.max' => 'La descripción es demasiado larga.',
            'fecha_vencimiento.after_or_equal' => 'La fecha de vencimiento no puede ser menor a la de firma.',
            'archivo.mimes'   => 'El archivo debe ser PDF o DOCX.',
            'archivo.max'     => 'El archivo no puede superar 20MB.',
        ];
    }
}