<!doctype html>
<html lang="es">
<head>
    <meta charset="utf-8">
    <title>Análisis de riesgo</title>
    <style>
        body { font-family: DejaVu Sans, sans-serif; font-size: 12px; color:#111827; }
        h1, h2, h3 { margin: 0 0 6px 0; }
        .badge { display:inline-block; padding:2px 6px; border-radius:4px; font-size:11px; }
        .alto  { background:#b91c1c; color:#fff; }
        .medio { background:#f59e0b; color:#111827; }
        .bajo  { background:#059669; color:#fff; }
        table { width:100%; border-collapse:collapse; margin-top:10px; }
        th, td { border:1px solid #e5e7eb; padding:4px 6px; }
        th { background:#f3f4f6; }
        .small { font-size:11px; }
    </style>
</head>
<body>
    <h1>Análisis de riesgo contractual</h1>

    <h2>{{ $analisis->convenio_titulo }}</h2>
    <p class="small">
        Convenio ID: {{ $analisis->convenio_id }}<br>
        Versión: v{{ $analisis->numero_version ?? '—' }}<br>
        Fecha de análisis: {{ \Carbon\Carbon::parse($analisis->analizado_en)->format('d/m/Y H:i') }}<br>
        Modelo / método: {{ $analisis->modelo }}
    </p>

    @php
        $nivel = strtoupper($analisis->risk_level ?? 'BAJO');
        $score = max(0, min(1, (float)$analisis->score));
        $pct   = round($score * 100);
    @endphp

    <h3>Resumen</h3>
    <p>
        Nivel de riesgo:
        @if($nivel === 'ALTO')
            <span class="badge alto">ALTO</span>
        @elseif($nivel === 'MEDIO')
            <span class="badge medio">MEDIO</span>
        @else
            <span class="badge bajo">BAJO</span>
        @endif
        &nbsp; | &nbsp;
        Confianza: {{ $pct }}% <br>
        Coincidencias detectadas: {{ $analisis->matches }}
    </p>

    @if(count($detalles))
        <h3>Cláusulas observadas (resumen)</h3>
        <table>
            <thead>
                <tr>
                    <th>Pág.</th>
                    <th>Línea</th>
                    <th>Texto / token</th>
                    <th>Severidad</th>
                    <th>Fuente</th>
                </tr>
            </thead>
            <tbody>
                @foreach($detalles as $d)
                    @php
                        $lbl = json_decode($d->label_json ?? '{}', true);
                        $sev = strtoupper($lbl['severity'] ?? 'NONE');
                    @endphp
                    <tr>
                        <td class="small">{{ $d->page ?? '–' }}</td>
                        <td class="small">{{ $d->line ?? '–' }}</td>
                        <td class="small">{{ $d->text }}</td>
                        <td class="small">{{ $sev }}</td>
                        <td class="small">{{ strtoupper($d->source ?? '') }}</td>
                    </tr>
                @endforeach
            </tbody>
        </table>
    @endif
</body>
</html>