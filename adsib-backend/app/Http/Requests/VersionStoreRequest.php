<?php
namespace App\Http\Requests;
use Illuminate\Foundation\Http\FormRequest;

class VersionStoreRequest extends FormRequest
{
    public function authorize(): bool { return true; }

    protected function prepareForValidation(): void
    {
        $this->merge([
            'observaciones' => $this->observaciones ? trim($this->observaciones) : null
        ]);
    }

    public function rules(): array
    {
        return [
            'archivo'        => ['required','file','mimes:pdf,docx','max:20480'],
            'observaciones'  => ['nullable','string','max:500'],
        ];
    }

    public function messages(): array
    {
        return [
            'archivo.required' => 'Debes seleccionar un archivo.',
            'archivo.mimes'    => 'El archivo debe ser PDF o DOCX.',
            'archivo.max'      => 'El archivo no puede superar 20MB.',
            'observaciones.max'=> 'Máximo 500 caracteres.',
        ];
    }
}