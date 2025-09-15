<?php
namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class UsuarioUpdateRequest extends FormRequest
{
    public function authorize(): bool { return true; }
    public function rules(): array {
        $id = $this->route('usuario') ?? $this->route('id');
        return [
            'nombre'                  => 'sometimes|required|string|min:3|max:150',
            'email'                   => 'sometimes|required|email:rfc|max:150|unique:usuarios,email,'.$id,
            'password'                => 'nullable|string|min:8|max:255|confirmed',
        ];
    }
}