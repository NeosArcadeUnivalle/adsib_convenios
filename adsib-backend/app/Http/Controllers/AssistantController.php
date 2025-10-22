<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Support\Facades\Http;

/**
 * Controller maestro del Asistente Virtual para la base adsib_db.
 *
 * Reglas importantes:
 *  - Nunca mencionar un convenio por su ID; usar siempre su "titulo".
 *  - Preferir respuestas rápidas con SQL directo y plantillas.
 *  - Incluir latencias en "meta.timings" y lista de SQL ejecutadas.
 *  - Fuzzy search para convenio por nombre (titulo).
 *  - Fallback amable con Ollama (llama3.2:3b) para lenguaje natural.
 */
class AssistantController extends Controller
{
    // Config de Ollama (mismo enfoque que tu controlador antiguo: sin inyección)
    protected string $ollamaUrl;
    protected string $ollamaModel;
    protected int $ollamaTimeout;

    public function __construct()
    {
        $this->ollamaUrl     = rtrim(env('OLLAMA_URL', 'http://127.0.0.1:11434'), '/');
        $this->ollamaModel   = env('OLLAMA_MODEL', 'llama3.2:3b');
        $this->ollamaTimeout = (int) env('OLLAMA_TIMEOUT', 60);
    }

    /* ============================================================
     * Utilidades de texto y fechas
     * ============================================================ */

    protected function norm(string $s): string
    {
        $s = mb_strtolower($s, 'UTF-8');
        $s = strtr($s, [
            'á'=>'a', 'é'=>'e', 'í'=>'i', 'ó'=>'o', 'ú'=>'u',
            'ä'=>'a', 'ë'=>'e', 'ï'=>'i', 'ö'=>'o', 'ü'=>'u',
            'ñ'=>'n',
        ]);
        return trim(preg_replace('/\s+/u', ' ', $s));
    }

    protected function like(string $s): string
    {
        // para usar en ILIKE '%...%'
        return '%'.str_replace(['%','_'], ['\%','\_'], $s).'%';
    }

    protected function asDate(?string $s): ?string
    {
        if (!$s) return null;
        try {
            return \Carbon\Carbon::parse($s)->toDateString();
        } catch (\Throwable $e) {
            return null;
        }
    }

    /* ============================================================
     * Resolución de entidades (siempre por NOMBRE)
     * ============================================================ */

    /**
     * Busca un convenio por su TÍTULO (no por ID).
     * Estrategia: exacto (case-insensitive) -> ILIKE -> tokens.
     * Retorna registro completo o null.
     */
    protected function resolveConvenioByTitle(string $userText): ?object
    {
        $q = $this->norm($userText);
        if ($q === '') return null;

        // 1) exacto (case insensitive)
        $row = DB::table('convenios')
            ->whereRaw('LOWER(titulo) = ?', [mb_strtolower($userText, 'UTF-8')])
            ->first();
        if ($row) return $row;

        // 2) ILIKE %frase completa%
        $row = DB::table('convenios')
            ->where('titulo', 'ILIKE', $this->like($userText))
            ->orderBy('fecha_vencimiento', 'asc')
            ->first();
        if ($row) return $row;

        // 3) Tokenizado: intersectar tokens significativos
        $tokens = array_filter(explode(' ', $q), fn($t) => mb_strlen($t) >= 3);
        if (empty($tokens)) return null;

        $builder = DB::table('convenios');
        foreach ($tokens as $t) {
            $builder->where('titulo', 'ILIKE', $this->like($t));
        }
        return $builder->orderBy('fecha_vencimiento', 'asc')->first();
    }

    /* ============================================================
     * Render helpers (SIEMPRE por nombre)
     * ============================================================ */

    protected function fmtConvenioRow(object $r): string
    {
        $vto  = $r->fecha_vencimiento ? \Carbon\Carbon::parse($r->fecha_vencimiento)->isoFormat('LL') : '—';
        $firm = $r->fecha_firma       ? \Carbon\Carbon::parse($r->fecha_firma)->isoFormat('LL')       : '—';
        return "• {$r->titulo}\n  - Estado: {$r->estado}\n  - Fecha Firma: {$firm}\n  - Fecha Vencimiento: {$vto}";
    }

    protected function listToBullets(array $items): string
    {
        return implode("\n", array_map(fn($s) => "• {$s}", $items));
    }

    /* ============================================================
     * Intents (patrones) rápidos
     * ============================================================ */

    /**
     * Define intenciones de alta cobertura con sus handlers.
     * Cada handler retorna ['reply'=>string,'meta'=>array].
     */
    protected function intents(): array
    {
        return [

            /* -------- VENCIMIENTOS / PRIORIDAD -------- */

            [
                'keys' => [
                    '/(proximo|mas proximo|pr[oó]ximo).*(vencer|vencimiento)/iu',
                    '/(cual(es)?|que).*convenio(s)?.*(vencer[aá]n?|vencen).*pronto/iu',
                    '/prioridad.*(atender|gestionar)/iu',
                ],
                'handle' => function(Request $req) {
                    $sqlStarted = microtime(true);
                    $rows = DB::table('convenios')
                        ->select('id','titulo','estado','fecha_vencimiento','fecha_firma')
                        ->whereNotNull('fecha_vencimiento')
                        ->whereIn('estado', ['VIGENTE','NEGOCIACION'])
                        ->orderBy('fecha_vencimiento','asc')
                        ->limit(10)
                        ->get();
                    $sqlMs = (microtime(true) - $sqlStarted) * 1000;

                    if ($rows->isEmpty()) {
                        return $this->ok("No encontré convenios próximos a vencer.", [
                            'sql' => ['q' => 'convenios próximos a vencer (<=10)'],
                            'timings' => ['sql_ms' => round($sqlMs)]
                        ]);
                    }

                    $first = $rows->first();
                    $head  = "Convenios más próximos a vencer (top 10):";
                    $list  = $rows->map(fn($r) => $this->fmtConvenioRow($r))->implode("\n");
                    $reply = "{$head}\n{$list}\n\nEl más próximo: {$first->titulo}.";
                    return $this->ok($reply, [
                        'intent'  => 'vencimientos.proximos',
                        'sql'     => ['q' => 'SELECT ... ORDER BY fecha_vencimiento ASC LIMIT 10'],
                        'timings' => ['sql_ms' => round($sqlMs)]
                    ]);
                }
            ],

            [
                'keys' => [
                    '/convenio(s)?.*prioridad/iu',
                    '/(atender|gestionar).*(primero|prioridad)/iu',
                ],
                'handle' => function(Request $req) {
                    // Prioridad: riesgo ALTO o MEDIO + vencimiento dentro de 30 días
                    $sqlStarted = microtime(true);
                    $rows = DB::table('convenios as c')
                        ->leftJoin('analisis_riesgos as a', function($j){
                            $j->on('a.convenio_id','=','c.id');
                        })
                        ->select('c.titulo','c.estado','c.fecha_vencimiento', DB::raw("coalesce(a.risk_level,'BAJO') as risk"))
                        ->whereIn('c.estado', ['VIGENTE','NEGOCIACION'])
                        ->whereNotNull('c.fecha_vencimiento')
                        ->whereDate('c.fecha_vencimiento','<=', now()->addDays(30)->toDateString())
                        ->orderByRaw("CASE coalesce(a.risk_level,'BAJO') WHEN 'ALTO' THEN 1 WHEN 'MEDIO' THEN 2 ELSE 3 END")
                        ->orderBy('c.fecha_vencimiento','asc')
                        ->limit(20)
                        ->get();
                    $sqlMs = (microtime(true) - $sqlStarted) * 1000;

                    if ($rows->isEmpty()) {
                        return $this->ok("No hay convenios con vencimiento en los próximos 30 días.", [
                            'intent'  => 'prioridad.30dias',
                            'timings' => ['sql_ms'=>round($sqlMs)]
                        ]);
                    }

                    $reply = "Prioridad (vence ≤30 días y según riesgo):\n".
                        $rows->map(function($r){
                            $vto = \Carbon\Carbon::parse($r->fecha_vencimiento)->isoFormat('LL');
                            return "• {$r->titulo} — Riesgo: {$r->risk} — Vence: {$vto}";
                        })->implode("\n");

                    return $this->ok($reply, [
                        'intent'=>'prioridad.30dias',
                        'timings'=>['sql_ms'=>round($sqlMs)]
                    ]);
                }
            ],

            /* -------- LISTADOS POR RIESGO -------- */

            [
                'keys' => [
                    '/(cuales|listado|lista|muestrame).*convenios.*(nivel|riesgo).*alto/iu',
                    '/convenios.*riesgo.*alto/iu',
                ],
                'handle' => function(Request $req){
                    $sqlStarted = microtime(true);
                    $rows = DB::table('convenios as c')
                        ->join('analisis_riesgos as a','a.convenio_id','=','c.id')
                        ->select('c.titulo','c.estado','c.fecha_vencimiento','a.score')
                        ->where('a.risk_level','ALTO')
                        ->orderByDesc('a.score')
                        ->limit(50)
                        ->get();
                    $sqlMs = (microtime(true) - $sqlStarted) * 1000;

                    if ($rows->isEmpty()) {
                        return $this->ok("No hay convenios con nivel de riesgo **ALTO** registrados.", [
                            'intent'=>'riesgo.alto','timings'=>['sql_ms'=>round($sqlMs)]
                        ]);
                    }

                    $reply = "Convenios con riesgo **ALTO** (ordenados por score):\n".
                        $rows->map(function($r){
                            $vto = $r->fecha_vencimiento ? \Carbon\Carbon::parse($r->fecha_vencimiento)->isoFormat('LL') : '—';
                            $score = number_format((float)$r->score, 3);
                            return "• {$r->titulo} — Score: {$score} — Vence: {$vto}";
                        })->implode("\n");

                    return $this->ok($reply, [
                        'intent'=>'riesgo.alto','timings'=>['sql_ms'=>round($sqlMs)]
                    ]);
                }
            ],

            [
                'keys' => [
                    '/(cuales|listado|lista|muestrame).*convenios.*(nivel|riesgo).*medio/iu',
                    '/convenios.*riesgo.*medio/iu',
                ],
                'handle' => function(Request $req){
                    $rows = DB::table('convenios as c')
                        ->join('analisis_riesgos as a','a.convenio_id','=','c.id')
                        ->select('c.titulo','c.estado','c.fecha_vencimiento','a.score')
                        ->where('a.risk_level','MEDIO')
                        ->orderByDesc('a.score')
                        ->limit(50)
                        ->get();
                    if ($rows->isEmpty()) {
                        return $this->ok("No hay convenios con nivel de riesgo **MEDIO** registrados.");
                    }
                    $reply = "Convenios con riesgo **MEDIO**:\n".
                        $rows->map(function($r){
                            $vto = $r->fecha_vencimiento ? \Carbon\Carbon::parse($r->fecha_vencimiento)->isoFormat('LL') : '—';
                            return "• {$r->titulo} — Score: ".number_format((float)$r->score,3)." — Vence: {$vto}";
                        })->implode("\n");
                    return $this->ok($reply,['intent'=>'riesgo.medio']);
                }
            ],

            [
                'keys' => [
                    '/(cuales|listado|lista|muestrame).*convenios.*(nivel|riesgo).*bajo/iu',
                    '/convenios.*riesgo.*bajo/iu',
                ],
                'handle' => function(Request $req){
                    $rows = DB::table('convenios as c')
                        ->leftJoin('analisis_riesgos as a','a.convenio_id','=','c.id')
                        ->select('c.titulo','c.estado','c.fecha_vencimiento', DB::raw("COALESCE(a.score,0) as score"))
                        ->where(function($q){
                            $q->whereNull('a.risk_level')->orWhere('a.risk_level','BAJO');
                        })
                        ->orderBy('c.fecha_vencimiento','asc')
                        ->limit(50)
                        ->get();

                    if ($rows->isEmpty()) {
                        return $this->ok("No hay convenios con riesgo **BAJO** (o sin análisis) para listar.");
                    }

                    $reply = "Convenios con riesgo **BAJO** (o sin análisis):\n".
                        $rows->map(function($r){
                            $vto = $r->fecha_vencimiento ? \Carbon\Carbon::parse($r->fecha_vencimiento)->isoFormat('LL') : '—';
                            return "• {$r->titulo} — Vence: {$vto}";
                        })->implode("\n");
                    return $this->ok($reply, ['intent'=>'riesgo.bajo']);
                }
            ],

            /* -------- LISTADOS POR ESTADO -------- */

            [
                'keys' => [
                    '/listado.*convenios$/iu',
                    '/^listado de todos los convenios/iu',
                    '/^todos los convenios/iu',
                ],
                'handle' => function(Request $req){
                    $rows = DB::table('convenios')
                        ->select('titulo','estado','fecha_firma','fecha_vencimiento')
                        ->orderBy('titulo','asc')
                        ->get();
                    if ($rows->isEmpty()) {
                        return $this->ok("No hay convenios registrados todavía.", ['intent'=>'convenios.todos']);
                    }
                    $reply = "Listado de convenios (alfabético):\n".
                        $rows->map(fn($r)=>$this->fmtConvenioRow($r))->implode("\n");
                    return $this->ok($reply,['intent'=>'convenios.todos']);
                }
            ],

            $this->intentConveniosPorEstado('CERRADO'),
            $this->intentConveniosPorEstado('NEGOCIACION'),
            $this->intentConveniosPorEstado('BORRADOR'),
            $this->intentConveniosPorEstado('VENCIDO'),
            $this->intentConveniosPorEstado('VIGENTE'),
            $this->intentConveniosPorEstado('SUSPENDIDO'),
            $this->intentConveniosPorEstado('RESCINDIDO'),

            /* -------- ORDENAMIENTOS -------- */

            [
                'keys' => [
                    '/(listado|lista).*convenios.*(orden|ordena).*vencimiento/iu',
                    '/convenios.*por.*fecha.*vencimiento/iu',
                ],
                'handle' => function(Request $req){
                    $rows = DB::table('convenios')
                        ->whereNotNull('fecha_vencimiento')
                        ->orderBy('fecha_vencimiento','asc')
                        ->get();
                    if ($rows->isEmpty()) {
                        return $this->ok("No hay convenios con fecha de vencimiento establecida.");
                    }
                    $reply = "Convenios ordenados por fecha de vencimiento (ascendente):\n".
                        $rows->map(fn($r)=>$this->fmtConvenioRow($r))->implode("\n");
                    return $this->ok($reply,['intent'=>'orden.vencimiento.asc']);
                }
            ],

            [
                'keys' => [
                    '/(listado|lista).*convenios.*(orden|ordena).*firma/iu',
                    '/convenios.*por.*fecha.*firma/iu',
                ],
                'handle' => function(Request $req){
                    $rows = DB::table('convenios')
                        ->whereNotNull('fecha_firma')
                        ->orderBy('fecha_firma','asc')
                        ->get();
                    if ($rows->isEmpty()) {
                        return $this->ok("No hay convenios con fecha de firma registrada.");
                    }
                    $reply = "Convenios ordenados por fecha de firma (ascendente):\n".
                        $rows->map(fn($r)=>$this->fmtConvenioRow($r))->implode("\n");
                    return $this->ok($reply,['intent'=>'orden.firma.asc']);
                }
            ],

            /* -------- VERSIONES / DETALLES DE CONVENIO -------- */

            [
                'keys' => [
                    '/cuantas versiones tiene el convenio (.+)\?/iu',
                    '/numero de versiones del convenio (.+)/iu',
                    '/versiones.*de(l)? convenio (.+)/iu',
                ],
                'handle' => function(Request $req, array $m=null){
                    // Captura del nombre desde el texto completo
                    $name = $this->extractName($req->input('message',''), ['cuantas versiones tiene el convenio','numero de versiones del convenio','versiones de convenio','versiones del convenio']);
                    if (!$name) {
                        return $this->ok("¿De qué convenio necesitas saber sus versiones? Dime el **título** exacto o parte de él.");
                    }
                    $conv = $this->resolveConvenioByTitle($name);
                    if (!$conv) {
                        return $this->ok("No encontré un convenio cuyo título se parezca a **{$name}**.");
                    }
                    $count = DB::table('versiones_convenio')->where('convenio_id',$conv->id)->count();
                    return $this->ok("El convenio **{$conv->titulo}** tiene **{$count}** versiones registradas.", [
                        'intent'=>'convenio.versiones.count'
                    ]);
                }
            ],

            [
                'keys' => [
                    '/(detalles|detalle|informaci[oó]n) (de|del) convenio (.+)/iu',
                    '/dame mas detalles del convenio (.+)/iu',
                ],
                'handle' => function(Request $req){
                    $name = $this->extractName($req->input('message',''), ['detalles del convenio','detalle del convenio','informacion del convenio','información del convenio','dame mas detalles del convenio']);
                    if (!$name) return $this->ok("Indica el **título** del convenio para ver sus detalles.");
                    $conv = $this->resolveConvenioByTitle($name);
                    if (!$conv) return $this->ok("No encontré un convenio similar a **{$name}**.");
                    // Último riesgo (si existe)
                    $risk = DB::table('analisis_riesgos')->where('convenio_id',$conv->id)->orderByDesc('analizado_en')->first();
                    $riskStr = $risk ? "{$risk->risk_level} (score ".number_format((float)$risk->score,3).")" : "—";
                    // Versiones
                    $versions = DB::table('versiones_convenio')
                        ->select('numero_version','fecha_version','observaciones')
                        ->where('convenio_id',$conv->id)
                        ->orderByDesc('numero_version')
                        ->limit(10)->get();
                    $reply = "Detalles del convenio **{$conv->titulo}**\n".
                             "- Estado: {$conv->estado}\n".
                             "- Fecha de Firma: ".($conv->fecha_firma ? \Carbon\Carbon::parse($conv->fecha_firma)->isoFormat('LL') : '—')."\n".
                             "- Fecha de Vencimiento: ".($conv->fecha_vencimiento ? \Carbon\Carbon::parse($conv->fecha_vencimiento)->isoFormat('LL') : '—')."\n".
                             "- Riesgo más reciente: {$riskStr}\n".
                             "- Versiones (máx. 10):\n".
                             ($versions->isEmpty() ? "  • Sin versiones registradas" :
                                $versions->map(function($v){
                                    $fv = \Carbon\Carbon::parse($v->fecha_version)->isoFormat('LL');
                                    $obs = $v->observaciones ? " — {$v->observaciones}" : "";
                                    return "  • v{$v->numero_version} ({$fv}){$obs}";
                                })->implode("\n")
                             );
                    return $this->ok($reply,['intent'=>'convenio.detalles']);
                }
            ],

            [
                'keys' => [
                    '/listado de versiones del convenio (.+)/iu',
                    '/(muestrame|listar|lista) versiones (de|del) convenio (.+)/iu',
                ],
                'handle' => function(Request $req){
                    $name = $this->extractName($req->input('message',''), ['listado de versiones del convenio','muestrame versiones del convenio','listar versiones del convenio','lista versiones del convenio','versiones del convenio']);
                    if (!$name) return $this->ok("Indica el **título** del convenio.");
                    $conv = $this->resolveConvenioByTitle($name);
                    if (!$conv) return $this->ok("No encontré un convenio parecido a **{$name}**.");
                    $rows = DB::table('versiones_convenio')
                        ->select('numero_version','fecha_version','observaciones')
                        ->where('convenio_id',$conv->id)
                        ->orderBy('numero_version','asc')->get();
                    if ($rows->isEmpty()) {
                        return $this->ok("**{$conv->titulo}** aún no tiene versiones registradas.");
                    }
                    $reply = "Versiones de **{$conv->titulo}**:\n".
                        $rows->map(function($v){
                            $fv = \Carbon\Carbon::parse($v->fecha_version)->isoFormat('LL');
                            $obs = $v->observaciones ? " — {$v->observaciones}" : "";
                            return "• v{$v->numero_version} ({$fv}){$obs}";
                        })->implode("\n");
                    return $this->ok($reply,['intent'=>'convenio.versiones.list']);
                }
            ],

            /* -------- USUARIOS / NOTIFICACIONES / LOGS -------- */

            [
                'keys' => [
                    '/(listado|lista).*usuarios$/iu',
                    '/^listado de los mis usuarios$/iu',
                ],
                'handle' => function(Request $req){
                    $rows = DB::table('usuarios')->select('nombre','email','created_at')->orderBy('nombre','asc')->get();
                    if ($rows->isEmpty()) return $this->ok("No hay usuarios registrados.");
                    $reply = "Usuarios:\n".
                        $rows->map(function($u){
                            $f = $u->created_at ? \Carbon\Carbon::parse($u->created_at)->isoFormat('LL') : '—';
                            return "• {$u->nombre} — {$u->email} — Alta: {$f}";
                        })->implode("\n");
                    return $this->ok($reply,['intent'=>'usuarios.list']);
                }
            ],

            [
                'keys' => [
                    '/informaci[oó]n de mi usuario (.+)/iu',
                    '/detalles de usuario (.+)/iu',
                ],
                'handle' => function(Request $req){
                    $name = $this->extractName($req->input('message',''), ['informacion de mi usuario','información de mi usuario','detalles de usuario']);
                    if (!$name) return $this->ok("Indica el **nombre** o el **email** del usuario.");
                    $row = DB::table('usuarios')
                        ->where('nombre','ILIKE',$this->like($name))
                        ->orWhere('email','ILIKE',$this->like($name))
                        ->first();
                    if (!$row) return $this->ok("No encontré un usuario que coincida con **{$name}**.");
                    $reply = "Usuario: {$row->nombre}\nEmail: {$row->email}\nAlta: ".\Carbon\Carbon::parse($row->created_at)->isoFormat('LL');
                    return $this->ok($reply,['intent'=>'usuarios.info']);
                }
            ],

            [
                'keys' => [
                    '/^notificaciones que tengo$/iu',
                    '/^mis notificaciones$/iu',
                    '/^notificaciones pendientes$/iu',
                ],
                'handle' => function(Request $req){
                    $rows = DB::table('notificaciones')
                        ->join('convenios as c','c.id','=','notificaciones.convenio_id')
                        ->select('notificaciones.*','c.titulo')
                        ->orderBy('fecha_envio','desc')->limit(50)->get();

                    if ($rows->isEmpty()) return $this->ok("No tienes notificaciones.");
                    $reply = "Notificaciones (máx. 50):\n".
                        $rows->map(function($n){
                            $f = $n->fecha_envio ? \Carbon\Carbon::parse($n->fecha_envio)->isoFormat('LLL') : '—';
                            $estado = $n->leido ? 'LEÍDA' : 'PENDIENTE';
                            return "• {$f} — {$n->tipo} — {$estado} — Convenio: {$n->titulo}\n  {$n->mensaje}";
                        })->implode("\n");
                    return $this->ok($reply,['intent'=>'notificaciones.list']);
                }
            ],

            [
                'keys' => [
                    '/(logs|historial|bit[aá]cora) (de|del) convenio (.+)/iu',
                ],
                'handle' => function(Request $req){
                    $name = $this->extractName($req->input('message',''), ['logs del convenio','historial del convenio','bitacora del convenio','bitácora del convenio']);
                    if (!$name) return $this->ok("Indica el **título** del convenio.");
                    $conv = $this->resolveConvenioByTitle($name);
                    if (!$conv) return $this->ok("No encontré un convenio parecido a **{$name}**.");
                    $rows = DB::table('logs_documentales as l')
                        ->leftJoin('usuarios as u','u.id','=','l.usuario_id')
                        ->select('l.*', 'u.nombre as usuario')
                        ->where('l.convenio_id',$conv->id)
                        ->orderBy('l.fecha','desc')->limit(50)->get();

                    if ($rows->isEmpty()) return $this->ok("**{$conv->titulo}** no tiene registros de bitácora.");
                    $reply = "Bitácora de **{$conv->titulo}** (máx. 50):\n".
                        $rows->map(function($r){
                            $f = $r->fecha ? \Carbon\Carbon::parse($r->fecha)->isoFormat('LLL') : '—';
                            $user = $r->usuario ?: '—';
                            $desc = $r->descripcion ? " — {$r->descripcion}" : "";
                            return "• {$f} — {$r->accion} — Usuario: {$user}{$desc}";
                        })->implode("\n");
                    return $this->ok($reply,['intent'=>'logs.convenio']);
                }
            ],

            /* -------- COMPARACIONES -------- */

            [
                'keys' => [
                    '/comparar versiones de (.+)/iu',
                    '/diferencias entre versiones de (.+)/iu',
                ],
                'handle' => function(Request $req){
                    $name = $this->extractName($req->input('message',''), ['comparar versiones de','diferencias entre versiones de']);
                    if (!$name) return $this->ok("Indica el **título** del convenio.");
                    $conv = $this->resolveConvenioByTitle($name);
                    if (!$conv) return $this->ok("No encontré un convenio parecido a **{$name}**.");

                    // Tomar las dos últimas versiones
                    $lastTwo = DB::table('versiones_convenio')
                        ->where('convenio_id',$conv->id)
                        ->orderByDesc('numero_version')
                        ->limit(2)->get();
                    if ($lastTwo->count() < 2) {
                        return $this->ok("**{$conv->titulo}** no tiene suficientes versiones para comparar (se requieren al menos 2).");
                    }

                    $vA = $lastTwo[1]; // penúltima
                    $vB = $lastTwo[0]; // última

                    // Buscar si ya existe comparación persistida
                    $cmp = DB::table('comparaciones')
                        ->where('version_base_id',$vA->id)
                        ->where('version_comparada_id',$vB->id)
                        ->first();

                    if (!$cmp) {
                        return $this->ok(
                            "Puedo preparar una comparación entre v{$vA->numero_version} y v{$vB->numero_version} del convenio **{$conv->titulo}**. " .
                            "Aún no hay un registro de comparación almacenado."
                        , ['intent'=>'comparaciones.pending']);
                    }

                    $sum = $cmp->resumen_cambios ?: '—';
                    $reply = "Comparación **{$conv->titulo}**: v{$vA->numero_version} → v{$vB->numero_version}\n".
                             "- Resumen cambios: {$sum}\n".
                             "- Diferencias detectadas: ".($cmp->diferencias_detectadas ? 'ver JSON' : '—');
                    return $this->ok($reply,['intent'=>'comparaciones.show']);
                }
            ],

            /* -------- HISTORIAL DE RIESGO -------- */

            [
                'keys' => [
                    '/(historial|analisis) de riesgo (de|del) convenio (.+)/iu',
                    '/riesgo historico (de|del) convenio (.+)/iu',
                ],
                'handle' => function(Request $req){
                    $name = $this->extractName($req->input('message',''), ['historial de riesgo del convenio','analisis de riesgo del convenio','riesgo historico del convenio']);
                    if (!$name) return $this->ok("Indica el **título** del convenio.");
                    $conv = $this->resolveConvenioByTitle($name);
                    if (!$conv) return $this->ok("No encontré un convenio parecido a **{$name}**.");

                    $rows = DB::table('analisis_riesgos')
                        ->select('risk_level','score','analizado_en')
                        ->where('convenio_id',$conv->id)
                        ->orderBy('analizado_en','desc')->limit(20)->get();

                    if ($rows->isEmpty()) return $this->ok("**{$conv->titulo}** aún no tiene análisis de riesgo.");
                    $reply = "Historial de riesgo de **{$conv->titulo}** (máx. 20):\n".
                        $rows->map(function($r){
                            $f = $r->analizado_en ? \Carbon\Carbon::parse($r->analizado_en)->isoFormat('LLL') : '—';
                            return "• {$f} — {$r->risk_level} (score ".number_format((float)$r->score,3).")";
                        })->implode("\n");
                    return $this->ok($reply,['intent'=>'riesgo.historial']);
                }
            ],

            /* -------- CONSULTAS GENERALES (catch-all “rápidas”) -------- */

            [
                'keys' => [
                    '/^ayuda$/iu','/^help$/iu','/qué puedes hacer/iu'
                ],
                'handle' => function(Request $req){
                    $reply = "Puedo ayudarte con:\n".
                    "• Próximos vencimientos, prioridades y listados por estado.\n".
                    "• Riesgos (ALTO/MEDIO/BAJO), historial de riesgo y datasets observados.\n".
                    "• Detalles y versiones de un convenio (por TÍTULO), comparaciones, logs y notificaciones.\n".
                    "• Usuarios (listado y datos).";
                    return $this->ok($reply,['intent'=>'help']);
                }
            ],
        ];
    }

    /**
     * “Plantilla” para intenciones de convenios por estado.
     */
    protected function intentConveniosPorEstado(string $estado): array
    {
        $pat = '/listado.*convenios.*estado.*'.preg_quote($estado,'/').'/iu';
        return [
            'keys' => [$pat, '/^listado de los convenios en estado '.preg_quote($estado,'/').'/iu'],
            'handle' => function(Request $req) use ($estado) {
                $rows = DB::table('convenios')
                    ->where('estado',$estado)
                    ->orderBy('titulo','asc')->get();
                if ($rows->isEmpty()) return $this->ok("No hay convenios en estado **{$estado}**.");
                $reply = "Convenios en estado **{$estado}**:\n".
                    $rows->map(fn($r)=>$this->fmtConvenioRow($r))->implode("\n");
                return $this->ok($reply, ['intent'=>"convenios.estado.{$estado}"]);
            }
        ];
    }

    /**
     * Extrae el “nombre” después de ciertos encabezados.
     * E.g. "cuantas versiones tiene el convenio X" -> "X"
     */
    protected function extractName(string $text, array $prefixes): ?string
    {
        $t = $this->norm($text);
        foreach ($prefixes as $p) {
            $pNorm = $this->norm($p);
            $pos = mb_strpos($t, $pNorm);
            if ($pos !== false) {
                $name = trim(mb_substr($text, $pos + mb_strlen($p)));
                // quita ? . , :
                $name = trim(trim($name), " \t\n\r\0\x0B?.:,");
                if ($name !== '') return $name;
            }
        }
        // fallback: después de “convenio ”
        if (preg_match('/convenio\s+(.+)$/iu', $text, $m)) {
            $name = trim($m[1]);
            $name = trim($name, " \t\n\r\0\x0B?.:,");
            return $name ?: null;
        }
        return null;
    }

    /* ============================================================
     * Respuesta estandarizada + medición de latencias
     * ============================================================ */

    protected function ok(string $reply, array $meta = [], int $code = 200)
    {
        $meta['ts'] = now()->toIso8601String();
        return response()->json(['reply' => $reply, 'meta' => $meta], $code);
    }

    /* ============================================================
     * Endpoint principal /assistant/chat
     * ============================================================ */

    public function chat(Request $request)
    {
        $started = microtime(true);
        $userMsg = (string)($request->input('message') ?? '');

        if (trim($userMsg) === '') {
            return $this->ok("Escribe tu pregunta. Por ejemplo: *“¿Cuál es el convenio más próximo a vencer?”*");
        }

        // 1) Intent matching rápido
        $intents = $this->intents();
        foreach ($intents as $intent) {
            foreach ($intent['keys'] as $rx) {
                if (preg_match($rx, $userMsg, $m)) {
                    $res = ($intent['handle'])($request, $m);
                    // Inyecta timing total y nombre de patrón
                    if ($res instanceof \Illuminate\Http\JsonResponse) {
                        $payload = $res->getData(true);
                        $meta    = $payload['meta'] ?? [];
                        $meta['timings']['total_ms'] = round((microtime(true) - $started) * 1000);
                        $meta['matched_regex'] = (string)$rx;
                        $meta['engine'] = 'fastpath';
                        $payload['meta'] = $meta;
                        return response()->json($payload, $res->getStatusCode());
                    }
                    return $res;
                }
            }
        }

        // 2) Si no hay intent claro, intentar respuestas guiadas por DB + LLM:
        //    - Detectar si menciona un convenio por TÍTULO para dar resumen ágil.
        $maybeTitle = $this->guessConvenioMention($userMsg);
        if ($maybeTitle) {
            $conv = $this->resolveConvenioByTitle($maybeTitle);
            if ($conv) {
                $risk = DB::table('analisis_riesgos')->where('convenio_id',$conv->id)->orderByDesc('analizado_en')->first();
                $riskStr = $risk ? "{$risk->risk_level} (score ".number_format((float)$risk->score,3).")" : "—";
                $vCount  = DB::table('versiones_convenio')->where('convenio_id',$conv->id)->count();
                $msg = "Resumen de **{$conv->titulo}**:\n".
                       "- Estado: {$conv->estado}\n".
                       "- Firma: ".($conv->fecha_firma ?: '—')."\n".
                       "- Vencimiento: ".($conv->fecha_vencimiento ?: '—')."\n".
                       "- Último Riesgo: {$riskStr}\n".
                       "- Cantidad de versiones: {$vCount}\n\n".
                       "¿Qué más te gustaría saber?";
                return $this->ok($msg, [
                    'intent'  => 'fallback.convenio.detectado',
                    'engine'  => 'fastpath',
                    'timings' => ['total_ms' => round((microtime(true) - $started)*1000)]
                ]);
            }
        }

        // 3) Fallback con LLM (parafraseo / aclaración), pero SIN inventar IDs.
        $prompt = <<<TXT
Eres un asistente para gestionar convenios. Responde breve y pide el TÍTULO
exacto del convenio cuando sea necesario. Nunca menciones ni pidas IDs.
Pregunta del usuario:
{$userMsg}
TXT;

        $llmStarted = microtime(true);
        try {
            $text = $this->askOllamaGenerate($prompt);
            $llmMs = (microtime(true) - $llmStarted) * 1000;

            return $this->ok($text, [
                'intent'  => 'fallback.llm',
                'engine'  => $this->ollamaModel,
                'timings' => [
                    'llm_ms'   => round($llmMs),
                    'total_ms' => round((microtime(true) - $started)*1000),
                ]
            ]);
        } catch (\Throwable $e) {
            return $this->ok(
                "No identifiqué la consulta. ¿Puedes dar más contexto o el **título** del convenio al que te refieres?",
                [
                    'intent'=>'fallback.safe',
                    'error' => $e->getMessage(),
                    'timings'=>['total_ms'=>round((microtime(true) - $started)*1000)]
                ]
            );
        }
    }

    /**
     * Heurística sencilla para detectar que el usuario escribió algo que parece
     * un nombre de convenio (frase larga tras la palabra “convenio”).
     */
    protected function guessConvenioMention(string $text): ?string
    {
        if (preg_match('/convenio\s+(.{3,})$/iu', trim($text), $m)) {
            $name = trim($m[1]);
            $name = trim($name, " \t\n\r\0\x0B?.:,");
            return $name ?: null;
        }
        return null;
    }

    /* ============================================================
     * Llamada directa a Ollama (sin usar clase externa)
     * ============================================================ */
    protected function askOllamaGenerate(string $prompt): string
    {
        $payload = [
            'model'   => $this->ollamaModel,
            'prompt'  => $prompt,
            'options' => [
                'temperature' => 0.2,
                'num_predict' => 200,
            ],
            'stream'  => false,
        ];

        $resp = Http::timeout($this->ollamaTimeout)
            ->withoutVerifying()
            ->post("{$this->ollamaUrl}/api/generate", $payload);

        if (!$resp->ok()) {
            throw new \RuntimeException("Ollama error {$resp->status()}: ".$resp->body());
        }

        $json = (array) $resp->json();
        return trim((string)($json['response'] ?? '¿Puedes reformular tu pregunta indicando el TÍTULO del convenio si aplica?'));
    }
}