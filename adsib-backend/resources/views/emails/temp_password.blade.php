<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <title>Recuperación de acceso</title>
</head>
<body style="font-family: Arial, sans-serif; background:#f3f4f6; padding:20px;">
    <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:8px;padding:20px;">
        <h2 style="color:#111827;">Sistema de Gestión de Convenios ADSIB</h2>

        <p>Hola <strong>{{ $nombre }}</strong>,</p>

        <p>Se ha solicitado la recuperación de acceso a tu cuenta.</p>

        <p>
            Tu <strong>contraseña temporal</strong> es:
        </p>

        <p style="font-size:18px;font-weight:bold;padding:10px 14px;background:#e5f3ff;border-radius:6px;display:inline-block;">
            {{ $password }}
        </p>

        <p style="margin-top:16px;">
            Por seguridad:
        </p>
        <ul>
            <li>Utiliza esta contraseña temporal para ingresar al sistema.</li>
            <li>Una vez dentro, ve al apartado de <strong>Usuarios &gt; Editar</strong> y cambia tu contraseña por una propia.</li>
            <li>No compartas esta clave con nadie.</li>
        </ul>

        <p style="margin-top:24px;color:#6b7280;font-size:12px;">
            Si tú no solicitaste este cambio, ignora este mensaje. Tu contraseña ha sido modificada,
            por lo que te recomendamos actualizarla nuevamente desde el sistema.
        </p>
    </div>
</body>
</html>