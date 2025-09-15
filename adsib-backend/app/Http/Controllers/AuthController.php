<?php
namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use App\Models\User;

class AuthController extends Controller
{
    public function login(Request $r)
    {
        $cred = $r->validate([
            'email'    => 'required|email',
            'password' => 'required|string|min:8|max:100',
        ], [
            'email.required'    => 'El correo es obligatorio.',
            'email.email'       => 'Formato de correo inválido.',
            'password.required' => 'La contraseña es obligatoria.',
        ]);

        $user = User::where('email', $cred['email'])->first();
        if (!$user || !Hash::check($cred['password'], $user->password)) {
            return response()->json(['message' => 'Credenciales inválidas'], 401);
        }

        // invalida tokens anteriores si quieres forzar 1 sesión:
        // $user->tokens()->delete();

        $token = $user->createToken('web')->plainTextToken;

        return response()->json([
            'token' => $token,
            'user'  => ['id'=>$user->id, 'nombre'=>$user->nombre, 'email'=>$user->email],
        ]);
    }

    public function me(Request $r)
    {
        $u = $r->user();
        return response()->json([
            'id'=>$u->id, 'nombre'=>$u->nombre, 'email'=>$u->email
        ]);
    }

    public function logout(Request $r)
    {
        // Revoca sólo el token actual
        $r->user()->currentAccessToken()->delete();
        return response()->json(['ok' => true]);
    }
}