<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use App\Models\User;
use App\Mail\TemporaryPasswordMail;

class AuthController extends Controller
{
    /**
     * POST /api/auth/login
     */
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

        // Si quisieras forzar 1 sesión, podrías borrar tokens anteriores:
        // $user->tokens()->delete();

        $token = $user->createToken('web')->plainTextToken;

        return response()->json([
            'token' => $token,
            'user'  => [
                'id'     => $user->id,
                'nombre' => $user->nombre,
                'email'  => $user->email,
            ],
        ]);
    }

    /**
     * GET /api/auth/me
     */
    public function me(Request $r)
    {
        $u = $r->user();

        return response()->json([
            'id'     => $u->id,
            'nombre' => $u->nombre,
            'email'  => $u->email,
        ]);
    }

    /**
     * POST /api/auth/logout
     */
    public function logout(Request $r)
    {
        $r->user()->currentAccessToken()->delete();

        return response()->json(['ok' => true]);
    }

    /**
     * POST /api/auth/forgot
     * Body: { "email": "usuario@dominio.com" }
     */
    public function forgot(Request $r)
    {
        $data = $r->validate([
            'email' => 'required|email',
        ], [
            'email.required' => 'El correo es obligatorio.',
            'email.email'    => 'Formato de correo inválido.',
        ]);

        $email = strtolower(trim($data['email']));

        // Solo permitir dominios @gmail.com y @adsib.gob.bo
        if (!preg_match('/(@gmail\.com|@adsib\.gob\.bo)$/i', $email)) {
            return response()->json([
                'message' => 'Si el correo existe en el sistema, se enviará una contraseña temporal.',
            ]);
        }

        $user = User::where('email', $email)->first();

        if ($user) {
            // Generar contraseña temporal
            $tmpPassword = Str::random(10);

            // Guardar hasheada
            $user->password = Hash::make($tmpPassword);
            $user->save();

            // Enviar correo
            try {
                Mail::to($user->email)
                    ->send(new TemporaryPasswordMail($user->nombre, $tmpPassword));
            } catch (\Throwable $e) {
                // Log para depurar si algo falla en producción
                Log::error('Error enviando correo de recuperación: '.$e->getMessage());
            }
        }

        // Respuesta genérica (no revela si el correo existe o no)
        return response()->json([
            'message' => 'Si el correo existe en el sistema, se enviará una contraseña temporal a tu bandeja de entrada.',
        ]);
    }
}