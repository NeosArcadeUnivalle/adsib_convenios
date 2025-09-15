<?php
namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class UsuarioStoreRequest extends FormRequest
{
    public function authorize(): bool { return true; }
    public function rules(): array {
        return [
            'nombre'                  => 'required|string|min:3|max:150',
            'email'                   => 'required|email:rfc|max:150|unique:usuarios,email',
            'password'                => 'required|string|min:8|max:255|confirmed',
        ];
    }
}