<?php

namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Queue\SerializesModels;

class TemporaryPasswordMail extends Mailable
{
    use Queueable, SerializesModels;

    public string $nombre;
    public string $password;

    /**
     * @param string $nombre  Nombre del usuario
     * @param string $password Contraseña temporal generada
     */
    public function __construct(string $nombre, string $password)
    {
        $this->nombre   = $nombre;
        $this->password = $password;
    }

    public function build()
    {
        return $this->subject('Recuperación de acceso - Sistema de Convenios ADSIB')
                    ->view('emails.temp_password');
    }
}