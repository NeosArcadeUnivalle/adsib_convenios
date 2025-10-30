<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Illuminate\Support\Facades\Schema;
use Carbon\Carbon;

class AssistantController extends Controller
{
    private string $ollamaUrl;
    private string $ollamaModel;
    private int    $ollamaTimeout;
    private ?string $semanticBase;

    // cache extensiones
    private static ?bool $hasUnaccent = null;
    private static ?bool $hasTrgm     = null;

    // alias/abreviaturas por defecto (puedes ampliarlo)
    private array $ALIASES = [
        'boa'   => ['boliviana de aviacion','boliviana de aviación','linea aerea boa','línea aérea boa','boa aerolínea','boa linea aerea'],
        'agetic'=> ['agencia de gobierno electronico y tic','agencia de gobierno electrónico y tic','agencia tic','agencia de tic','agencia gobierno electronico','agencia gobierno electrónico'],
        'umss'  => ['universidad mayor de san simon','universidad mayor de san simón'],
        'upb'   => ['universidad privada boliviana'],
        'msd'   => ['ministerio de salud y deportes','minsalud','ministerio de salud','ministerio salud deportes','min. salud y deportes','minsyd'],
        'sin'   => ['servicio de impuestos nacionales'],
        'bdp'   => ['banco de desarrollo productivo'],
        'egpp'  => ['escuela de gestion publica plurinacional','escuela de gestión pública plurinacional'],
        'emi'   => ['escuela militar de ingenieria','escuela militar de ingeniería'],
        'unandes'=>['universidad de los andes'],
        'cns'   => ['caja nacional de salud','cooperación interinstitucional cns'],
        'gad oruro'=>['gobierno autonomo departamental de oruro','gobierno autónomo departamental de oruro'],
    ];

    // stopwords que no aportan para nombre
    private array $STOP = ['el','la','los','las','un','una','unos','unas','de','del','al','con','para','por','mi','mis','su','sus','y','en','a','sobre','del','convenio','acuerdo','convenios'];

    public function __construct()
    {
        $this->ollamaUrl     = rtrim(env('OLLAMA_URL', 'http://127.0.0.1:11434'), '/');
        $this->ollamaModel   = env('OLLAMA_MODEL', 'llama3.2:3b');
        $this->ollamaTimeout = (int) env('OLLAMA_TIMEOUT', 45);
        $this->semanticBase  = rtrim(env('SEMANTIC_BASE', 'http://127.0.0.1:8010'), '/');
    }

    /* =========================================================
     *  POST /api/assistant/chat  { message, context? }
     * =======================================================*/
    public function chat(Request $r)
    {
        $msg     = trim((string)($r->input('message') ?? ''));
        $context = (array) ($r->input('context') ?? []);

        if ($msg === '') {
            return response()->json([
                'reply' => 'Escribe tu consulta…',
                'grounding' => ['type' => 'none']
            ]);
        }

        // Guard: solo convenios
        if (!$this->isAboutConvenios($msg)) {
            return response()->json([
                'reply' => 'Solo puedo ayudarte con consultas sobre convenios (títulos, versiones, fechas de firma/vencimiento, riesgo, notificaciones, responsables, descripciones). Reformula tu pregunta indicando el convenio o el dato que necesitas.',
                'grounding' => ['type' => 'guard']
            ]);
        }

        if ($direct = $this->tryDirectAnswers($msg, $context)) {
            return response()->json($direct, 200, [], JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
        }

        $ground = $this->buildGrounding($msg);

        try {
            $reply = $this->askOllama($msg, $ground['context_text']);
            return response()->json(['reply' => $reply, 'grounding' => $ground], 200, [], JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
        } catch (\Throwable $e) {
            Log::error('assistant_ollama_error', ['e' => $e->getMessage()]);
            return response()->json([
                'reply' => 'Ocurrió un problema al consultar la IA. Intenta nuevamente.',
                'grounding' => $ground
            ], 500);
        }
    }

    /* =================== Convenciones / Guard =================== */

    private function isAboutConvenios(string $msg): bool
    {
        $t = Str::lower($msg);
        $keys = [
            'convenio','convenios','versión','version','v1','v2','v3',
            'vencimiento','vence','fecha de firma','firmado',
            'riesgo','análisis de riesgo','analisis de riesgo',
            'cláusulas','clausulas','obligaciones','notificación','notificaciones',
            'detalle','detalles','descripción','descripcion','responsable','contacto',
            'comparación','comparacion','historial','archivo inicial','archivo final'
        ];
        foreach ($keys as $k) if (Str::contains($t, $k)) return true;
        if (preg_match('/["“”\'‘’].+["“”\'‘’]/u', $msg)) return true;
        return false;
    }

    /* =================== INTENTS DIRECTOS =================== */

    private function tryDirectAnswers(string $msg, array $ctx): ?array
    {
        $t = Str::lower($msg);

        // FECHA VENCIMIENTO de X
        if (preg_match('/\b(fecha|vence|vencimiento)\b.*\b(convenio)\b/u', $t) || preg_match('/\bvence\b/u', $t)) {
            if ($name = $this->extractConvenioMention($msg)) return $this->answerFechaVencimientoPorTitulo($name);
        }

        // VENCEN ESTE AÑO
        if (preg_match('/\b(vencen|vencimiento).*(año|ano|anio)\b/u', $t)) return $this->answerVencenEsteAnio();

        // FIRMADOS ESTE AÑO
        if (preg_match('/\bfirmados?\b.*\b(año|ano|anio)\b/u', $t) || preg_match('/\bconvenios\b.*\bfirmados\b/u', $t)) {
            return $this->answerFirmadosEsteAnio();
        }

        // LISTADOS / ORDENES
        if (preg_match('/\b(listado|lista|todos)\b.*\bconvenios\b/u', $t)) return $this->answerListadoConvenios();
        if (preg_match('/\bconvenios\b.*\b(orden|ordenados)\b.*\b(vencim|vencimiento)\b/u', $t)) return $this->answerOrdenPorVencimiento();
        if (preg_match('/\bconvenios\b.*\b(orden|ordenados)\b.*\b(firma)\b/u', $t)) return $this->answerOrdenPorFirma();
        if (preg_match('/\bconvenios\b.*\bestado\b.*\b(cerrado|negociacion|borrador|vencido)\b/u', $t, $m)) {
            return $this->answerPorEstado(Str::upper($m[1]));
        }
        if (preg_match('/\b(próximos|proximos)\b.*\b(vencer|vencen)\b.*\b(\d+)\b/u', $t, $m)) return $this->answerProximosNDias((int)$m[2]);
        if (preg_match('/\b(m[aá]s\s+pr[oó]ximo)\b.*\b(vencer|vencimiento)\b/u', $t)) return $this->answerMasProximo();

        // RIESGO nivel
        if (preg_match('/\b(nivel\s+)?riesgo\s+(alto|medio|bajo)\b/u', $t, $m) ||
            preg_match('/\btengo\b.*\bconvenios\b.*\bnivel\b.*\b(alto|medio|bajo)\b/u', $t, $m)) {
            return $this->answerRiesgo(Str::upper($m[2] ?? $m[1]));
        }

        // CLÁUSULAS del último análisis de X
        if (preg_match('/\b(cl[aá]usulas?|hallazgos?|coincidencias?)\b.*\b(analisis|an[aá]lisis)\b/u', $t)) {
            if ($name = $this->extractConvenioMention($msg)) return $this->answerClausulasUltimoAnalisisPorTitulo($name);
        }

        // Convenios con UNA versión
        if (preg_match('/\b(convenios?).*s[oó]lo.*una\s+versi[oó]n\b/u', $t) ||
            preg_match('/\b(convenios?).*(una\s+versi[oó]n)\b/u', $t)) return $this->answerConveniosUnaVersion();

        // ¿Cuántas versiones tiene X?
        if (preg_match('/\b(cu[aá]ntas?|cuantas?)\b.*\bversion(es)?\b/u', $t)) {
            if ($name = $this->extractConvenioMention($msg)) return $this->answerCantidadVersionesPorTitulo($name);
        }

        // Descripción de X
        if (preg_match('/\b(descripci[oó]n|descripcion)\b/u', $t)) {
            if ($name = $this->extractConvenioMention($msg)) return $this->answerDescripcionConvenio($name);
        }

        // Responsable/Contacto de X
        if (preg_match('/\b(contacto|responsable|persona)\b/u', $t)) {
            if ($name = $this->extractConvenioMention($msg)) return $this->answerContactoConvenio($name);
        }

        // Detalles de X
        if (preg_match('/\b(detalle|detalles|info|informaci[oó]n)\b/u', $t)) {
            if ($name = $this->extractConvenioMention($msg)) return $this->answerDetalleConvenioPorTitulo($name);
        }

        // Versiones de X
        if (preg_match('/\bversion(es)?\b/u', $t)) {
            if ($name = $this->extractConvenioMention($msg)) return $this->answerVersionesPorTitulo($name);
        }

        // Contenido versión específica
        if ($this->isAskVersionContent($msg)) return $this->answerContenidoVersion($msg);

        // Contenido convenio (última)
        if ($this->isAskConvenioContent($msg)) return $this->answerContenidoConvenioUltimaVersion($msg);

        // Notificaciones
        if (preg_match('/\bnotificaci[oó]n(es)?\b|\balertas?\b/u', $t)) return $this->answerNotificaciones();

        return null;
    }

    /* =================== NOMBRE DE CONVENIO: FLEX/FUZZY =================== */

    private function extractConvenioMention(string $msg): ?string
    {
        // 1) entre comillas
        if (preg_match('/["“”\'‘’]([^"“”\'‘’]+)["“”\'‘’]/u', $msg, $m)) {
            return $this->sanitizeName($m[1]);
        }
        // 2) “convenio con X …”
        if (preg_match('/\bconvenio\s+con\s+([^\.\n,]+?)(?=\s+(versi[oó]n|v\s*\d+|archivo|$))/iu', $msg, $m)) {
            return $this->sanitizeName($m[1]);
        }
        // 3) “mi convenio X …”, “del convenio X …”
        if (preg_match('/\b(?:mi\s+)?convenio\s+([^\.\n,]+)/iu', $msg, $m)) {
            return $this->sanitizeName($m[1]);
        }
        // 4) fallback: última palabra “fuerte” (mayúsculas/abreviatura) dentro del texto
        if (preg_match('/\b([A-ZÁÉÍÓÚÜÑ]{2,}[A-Za-zÁÉÍÓÚÜÑ0-9\.]*)\b/u', $msg, $m)) {
            return $this->sanitizeName($m[1]);
        }
        // 5) tokens significativos (sin stopwords), por si escribió “ministerio salud dep”
        $tokens = $this->significantTokens($msg);
        if (!empty($tokens)) return $this->sanitizeName(implode(' ', $tokens));
        return null;
    }

    private function sanitizeName(string $s): string
    {
        $s = trim($s);
        $s = trim($s, " \t\n\r\0\x0B\"'“”‘’.,;:!?()");
        return preg_replace('/\s+/u',' ',$s);
    }

    private function significantTokens(string $s): array
    {
        $s = Str::lower($this->stripAccents($s));
        $s = preg_replace('/[^\p{L}\p{N}\s]/u',' ',$s);
        $parts = preg_split('/\s+/u', $s, -1, PREG_SPLIT_NO_EMPTY);
        $parts = array_values(array_filter($parts, fn($w)=>!in_array($w, $this->STOP, true)));
        return $parts;
    }

    private function stripAccents(string $s): string
    {
        $map = [
            'á'=>'a','é'=>'e','í'=>'i','ó'=>'o','ú'=>'u','ü'=>'u','ñ'=>'n',
            'Á'=>'A','É'=>'E','Í'=>'I','Ó'=>'O','Ú'=>'U','Ü'=>'U','Ñ'=>'N'
        ];
        return strtr($s, $map);
    }

    // Chequeo de extensiones pg
    private function hasExtension(string $ext): bool
    {
        if ($ext === 'unaccent') {
            if (self::$hasUnaccent !== null) return self::$hasUnaccent;
        } else {
            if (self::$hasTrgm !== null) return self::$hasTrgm;
        }
        try {
            $row = DB::selectOne("SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = ?) AS ok", [$ext]);
            $ok = (bool) (($row->ok ?? $row->exists ?? false));
        } catch (\Throwable $e) {
            $ok = false;
        }
        if ($ext === 'unaccent') self::$hasUnaccent = $ok; else self::$hasTrgm = $ok;
        return $ok;
    }

    private function normalizeForSql(string $col): string
    {
        // Genera expresión SQL para comparar sin acentos y en minúsculas si hay unaccent
        if ($this->hasExtension('unaccent')) return "lower(unaccent({$col}))";
        return "lower({$col})";
    }

    /**
     * Busca el convenio más parecido al nombre/alias dado.
     * Devuelve fila completa de convenios o null.
     */
    private function fuzzyFindConvenio(string $name)
    {
        $name = $this->sanitizeName($name);
        $qBase = Str::lower($this->stripAccents($name));

        // expandir con alias
        $alts = [$qBase];
        foreach ($this->ALIASES as $key=>$arr) {
            if ($qBase === $key || Str::contains($qBase, $key) || in_array($qBase, $arr, true)) {
                $alts = array_unique(array_merge($alts, [$key], $arr));
            }
            foreach ($arr as $alias) {
                if (Str::contains($qBase, $alias)) $alts[] = $key;
            }
        }
        $alts = array_values(array_unique(array_map(function($x){ return trim($x); }, $alts)));

        // construir patrón LIKE
        $like = '%'.preg_replace('/\s+/u','%',$qBase).'%';

        $normTitulo = $this->normalizeForSql('titulo');
        $normDesc   = $this->normalizeForSql('descripcion');

        // pg_trgm prioritario si está
        $useTrgm = $this->hasExtension('pg_trgm');

        // Intento 1: pg_trgm con ORDER BY similarity DESC
        if ($useTrgm) {
            try {
                $rows = DB::table('convenios')
                    ->select('*')
                    ->orderByRaw("GREATEST(similarity($normTitulo, ?), similarity($normDesc, ?)) DESC", [$qBase, $qBase])
                    ->limit(5)
                    ->get();

                // filtrar por un mínimo razonable de similitud textual
                $best = null; $bestScore = -1;
                foreach ($rows as $r) {
                    $t = Str::lower($this->stripAccents((string)$r->titulo));
                    // bonus si contiene cualquier alt
                    $score = 0.0;
                    if (Str::contains($t, $qBase)) $score += 0.6;
                    foreach ($alts as $a) if ($a && Str::contains($t, $a)) $score += 0.5;
                    // heurística: distancia de Levenshtein limitada
                    $lv = levenshtein(substr($t,0,128), substr($qBase,0,128));
                    $score += max(0, 1.0 - min($lv/20.0, 1.0));
                    if ($score > $bestScore) { $bestScore = $score; $best = $r; }
                }
                if ($best) return $best;
            } catch (\Throwable $e) {
                // continuar a fallback
            }
        }

        // Intento 2: ILIKE sin trgm + prioridad por coincidencias de alias
        $rows = DB::table('convenios')
            ->select('*')
            ->whereRaw("$normTitulo LIKE ?", [$like])
            ->orWhereRaw("$normDesc LIKE ?", [$like])
            ->orderBy('updated_at','desc')
            ->limit(10)
            ->get();

        if ($rows->isEmpty()) {
            // Intento 3: probar cada alias como like
            foreach ($alts as $alt) {
                $lk = '%'.preg_replace('/\s+/u','%',$alt).'%';
                $rows = DB::table('convenios')
                    ->select('*')
                    ->whereRaw("$normTitulo LIKE ?", [$lk])
                    ->orWhereRaw("$normDesc LIKE ?", [$lk])
                    ->orderBy('updated_at','desc')
                    ->limit(10)
                    ->get();
                if ($rows->count()) break;
            }
        }

        if ($rows->isEmpty()) return null;

        // elegir mejor por heurística simple
        $best = null; $bestScore = -1;
        foreach ($rows as $r) {
            $t = Str::lower($this->stripAccents((string)$r->titulo));
            $score = 0.0;
            if (Str::contains($t, $qBase)) $score += 0.6;
            foreach ($alts as $a) if ($a && Str::contains($t, $a)) $score += 0.5;
            $lv = levenshtein(substr($t,0,128), substr($qBase,0,128));
            $score += max(0, 1.0 - min($lv/20.0, 1.0));
            if ($score > $bestScore) { $bestScore = $score; $best = $r; }
        }
        return $best;
    }

    /* -------------------- helpers intents ------------------- */

    private function isAskVersionContent(string $msg): bool
    {
        $t = Str::lower($msg);
        $verbs = '(contenido|contiene|que\s+dice|de\s+qu[eé]\s+(habla|trata)|habla|h[aá]blame|hablame|analiza|an[aá]lisis|explica|resume|resumen|detalla|cl[aá]usulas?|obligaciones?|pagos?|confidencialidad)';
        $ver  = '(versi[oó]n\s*\d+|\bv\s*\d+\b|\b(inicial|final)\b|archivo\s+(inicial|final))';
        return (bool) (preg_match("/{$verbs}/u", $t) && preg_match("/{$ver}/u", $t));
    }

    private function isAskConvenioContent(string $msg): bool
    {
        $t = Str::lower($msg);
        $verbs = '(contenido|contiene|que\s+dice|de\s+qu[eé]\s+(habla|trata)|habla|analiza|an[aá]lisis|explica|resume|resumen|cl[aá]usulas?|obligaciones?|pagos?|confidencialidad)';
        return (bool) (preg_match("/{$verbs}/u", $t) && preg_match('/\bconvenio\b/u', $t));
    }

    private function parseVersionHint(string $msg): array
    {
        $t = Str::lower($msg);
        if (preg_match('/\bv\s*(\d+)\b/u', $t, $m)) return ['type'=>'num','num'=>(int)$m[1]];
        if (preg_match('/versi(?:ón|on)\s*(\d+)/u', $t, $m)) return ['type'=>'num','num'=>(int)$m[1]];
        if (preg_match('/\barchivo\s+inicial\b/u', $t)) return ['type'=>'inicial'];
        if (preg_match('/\barchivo\s+final\b/u', $t))   return ['type'=>'final'];
        if (preg_match('/\binicial\b/u', $t))           return ['type'=>'inicial'];
        if (preg_match('/\bfinal\b/u', $t))             return ['type'=>'final'];
        return ['type'=>'unknown'];
    }

    /* ----------------- Respuestas DB (usando fuzzy) --------------------- */

    private function answerFechaVencimientoPorTitulo(string $needle): array
    {
        $c = $this->fuzzyFindConvenio($needle);
        if (!$c) return ['reply'=>"No encontré un convenio cuyo título se parezca a «{$this->sanitizeName($needle)}».",'grounding'=>['type'=>'query','total'=>0]];
        $fmt = fn($d)=> $d ? Carbon::parse($d)->locale('es')->isoFormat('D [de] MMMM [de] YYYY') : '—';
        return ['reply'=>"El convenio **{$c->titulo}** vence el **".$fmt($c->fecha_vencimiento)."** ({$c->estado}).",'grounding'=>['type'=>'convenio','id'=>$c->id]];
    }

    private function answerVencenEsteAnio(): array
    {
        $y = Carbon::now()->year;
        $rows = DB::table('convenios')
            ->select('titulo','estado','fecha_vencimiento')
            ->whereYear('fecha_vencimiento', $y)
            ->orderBy('fecha_vencimiento')
            ->get();

        if ($rows->isEmpty()) return ['reply'=>"No hay convenios que venzan en **{$y}**.",'grounding'=>['type'=>'query','total'=>0]];
        $fmt = fn($d)=> Carbon::parse($d)->locale('es')->isoFormat('D [de] MMMM [de] YYYY');
        $txt = "Convenios que vencen en **{$y}**:\n";
        foreach ($rows as $r) $txt .= "• {$r->titulo} — ".$fmt($r->fecha_vencimiento)." ({$r->estado})\n";
        return ['reply'=>$txt,'grounding'=>['type'=>'query','total'=>count($rows)]];
    }

    private function answerFirmadosEsteAnio(): array
    {
        $y = Carbon::now()->year;
        $rows = DB::table('convenios')
            ->select('titulo','estado','fecha_firma','fecha_vencimiento')
            ->whereYear('fecha_firma', $y)
            ->orderBy('fecha_firma')
            ->get();

        if ($rows->isEmpty()) return ['reply'=>"No hay convenios firmados en **{$y}**.",'grounding'=>['type'=>'query','total'=>0]];
        $fmt = fn($d)=> Carbon::parse($d)->locale('es')->isoFormat('D [de] MMMM [de] YYYY');
        $txt = "Convenios firmados en **{$y}**:\n";
        foreach ($rows as $r) $txt .= "• {$r->titulo} — Firma: ".$fmt($r->fecha_firma)." — Vence: ".$fmt($r->fecha_vencimiento)." ({$r->estado})\n";
        return ['reply'=>$txt,'grounding'=>['type'=>'query','total'=>count($rows)]];
    }

    private function answerListadoConvenios(): array
    {
        $rows = DB::table('convenios')
            ->select('id','titulo','estado','fecha_firma','fecha_vencimiento')
            ->orderBy('titulo')->get();

        if ($rows->isEmpty()) return ['reply'=>'No hay convenios registrados.','grounding'=>['type'=>'query','total'=>0]];

        $fmt = fn($d)=>$d ? Carbon::parse($d)->locale('es')->isoFormat('D [de] MMMM [de] YYYY') : '—';
        $txt = "Listado de convenios (alfabético):\n";
        foreach ($rows as $r) {
            $txt .= "• {$r->titulo}\n  - Estado: {$r->estado}\n  - Fecha Firma: ".$fmt($r->fecha_firma)."\n  - Fecha Vencimiento: ".$fmt($r->fecha_vencimiento)."\n";
        }
        return ['reply'=>$txt,'grounding'=>['type'=>'query','total'=>count($rows)]];
    }

    private function answerOrdenPorVencimiento(): array
    {
        $rows = DB::table('convenios')->select('titulo','estado','fecha_firma','fecha_vencimiento')
            ->orderBy('fecha_vencimiento')->get();
        if ($rows->isEmpty()) return ['reply'=>'No hay datos.','grounding'=>['type'=>'query','total'=>0]];

        $fmt = fn($d)=>$d ? Carbon::parse($d)->locale('es')->isoFormat('D [de] MMMM [de] YYYY') : '—';
        $txt = "Convenios ordenados por fecha de vencimiento (ascendente):\n";
        foreach ($rows as $r) {
            $txt .= "• {$r->titulo}\n  - Estado: {$r->estado}\n  - Fecha Firma: ".$fmt($r->fecha_firma)."\n  - Fecha Vencimiento: ".$fmt($r->fecha_vencimiento)."\n";
        }
        return ['reply'=>$txt,'grounding'=>['type'=>'query','total'=>count($rows)]];
    }

    private function answerOrdenPorFirma(): array
    {
        $rows = DB::table('convenios')->select('titulo','estado','fecha_firma','fecha_vencimiento')
            ->orderBy('fecha_firma')->get();
        if ($rows->isEmpty()) return ['reply'=>'No hay datos.','grounding'=>['type'=>'query','total'=>0]];

        $fmt = fn($d)=>$d ? Carbon::parse($d)->locale('es')->isoFormat('D [de] MMMM [de] YYYY') : '—';
        $txt = "Convenios ordenados por fecha de firma (ascendente):\n";
        foreach ($rows as $r) {
            $txt .= "• {$r->titulo}\n  - Estado: {$r->estado}\n  - Fecha Firma: ".$fmt($r->fecha_firma)."\n  - Fecha Vencimiento: ".$fmt($r->fecha_vencimiento)."\n";
        }
        return ['reply'=>$txt,'grounding'=>['type'=>'query','total'=>count($rows)]];
    }

    private function answerPorEstado(string $estado): array
    {
        $rows = DB::table('convenios')->select('titulo','fecha_vencimiento','estado')
            ->where('estado',$estado)->orderBy('titulo')->get();
        if ($rows->isEmpty()) return ['reply'=>"No hay convenios en estado {$estado}.",'grounding'=>['type'=>'query','total'=>0]];

        $fmt = fn($d)=>$d ? Carbon::parse($d)->locale('es')->isoFormat('D [de] MMMM [de] YYYY') : '—';
        $txt = "Convenios en estado {$estado}:\n";
        foreach ($rows as $r) $txt .= "• {$r->titulo} — Vence: ".$fmt($r->fecha_vencimiento)."\n";
        return ['reply'=>$txt,'grounding'=>['type'=>'query','total'=>count($rows)]];
    }

    private function answerProximosNDias(int $dias): array
    {
        $ini = now()->toDateString();
        $fin = now()->copy()->addDays($dias)->toDateString();
        $rows = DB::table('convenios')->select('titulo','estado','fecha_vencimiento')
            ->whereBetween(DB::raw('DATE(fecha_vencimiento)'), [$ini,$fin])
            ->orderBy('fecha_vencimiento')->get();
        if ($rows->isEmpty()) return ['reply'=>"No hay convenios por vencer en ≤ {$dias} días.",'grounding'=>['type'=>'query','total'=>0]];

        $fmt = fn($d)=>Carbon::parse($d)->locale('es')->isoFormat('D [de] MMMM [de] YYYY');
        $txt = "Convenios que vencen en ≤ {$dias} días:\n";
        foreach ($rows as $r) $txt .= "• {$r->titulo} — ".$fmt($r->fecha_vencimiento)." ({$r->estado})\n";
        return ['reply'=>$txt,'grounding'=>['type'=>'query','total'=>count($rows)]];
    }

    private function answerMasProximo(): array
    {
        $hoy = now()->toDateString();
        $r = DB::table('convenios')->select('titulo','estado','fecha_vencimiento')
            ->whereDate('fecha_vencimiento','>=',$hoy)->orderBy('fecha_vencimiento')->first();
        if (!$r) return ['reply'=>'No encontré convenios con vencimiento futuro.','grounding'=>['type'=>'query','total'=>0]];

        $fmt = fn($d)=>Carbon::parse($d)->locale('es')->isoFormat('D [de] MMMM [de] YYYY');
        return ['reply'=>"El convenio más próximo a vencer es **{$r->titulo}** — {$fmt($r->fecha_vencimiento)} ({$r->estado}).",'grounding'=>['type'=>'query','total'=>1]];
    }

    private function answerRiesgo(string $nivel): array
    {
        $sub = DB::table('analisis_riesgos')->select('convenio_id', DB::raw('MAX(created_at) mc'))->groupBy('convenio_id');
        $rows = DB::table('analisis_riesgos as ar')
            ->joinSub($sub,'s',fn($j)=>$j->on('ar.convenio_id','=','s.convenio_id')->on('ar.created_at','=','s.mc'))
            ->join('convenios as c','c.id','=','ar.convenio_id')
            ->where('ar.risk_level',$nivel)
            ->select('c.titulo','ar.score','c.fecha_vencimiento')
            ->orderByDesc('ar.score')->get();

        if ($rows->isEmpty()) return ['reply'=>"No hay convenios con riesgo **{$nivel}** en el último análisis.",'grounding'=>['type'=>'query','total'=>0]];

        $fmt = fn($d)=>$d ? Carbon::parse($d)->locale('es')->isoFormat('D [de] MMMM [de] YYYY') : '—';
        $txt = "Convenios con riesgo **{$nivel}** (último análisis):\n";
        foreach ($rows as $r) $txt .= "• {$r->titulo} — Score: ".number_format($r->score*100,0)."% — Vence: ".$fmt($r->fecha_vencimiento)."\n";
        return ['reply'=>$txt,'grounding'=>['type'=>'query','total'=>count($rows)]];
    }

    private function answerClausulasUltimoAnalisisPorTitulo(string $needle): array
    {
        $c = $this->fuzzyFindConvenio($needle);
        if (!$c) return ['reply'=>"No encontré un convenio cuyo título se parezca a «{$this->sanitizeName($needle)}».",'grounding'=>['type'=>'query','total'=>0]];

        $an = DB::table('analisis_riesgos')->where('convenio_id',$c->id)->orderByDesc('created_at')->first();
        if (!$an) return ['reply'=>"El convenio **{$c->titulo}** no tiene análisis de riesgo registrados.",'grounding'=>['type'=>'convenio','id'=>$c->id]];

        $rows = DB::table('riesgo_dataset')->where('convenio_id',$c->id);
        if ($an->version_id) $rows = $rows->where('version_id', $an->version_id);
        $rows = $rows->select('text','label_json')->limit(300)->get();

        if ($rows->isEmpty()) {
            return ['reply'=>"No hay cláusulas/hallazgos almacenados para el último análisis de **{$c->titulo}**.",'grounding'=>['type'=>'convenio','id'=>$c->id]];
        }

        $g = ['HIGH'=>[],'MEDIUM'=>[],'LOW'=>[],'NONE'=>[]];
        foreach ($rows as $r) {
            $lab = json_decode((string)$r->label_json,true) ?: [];
            $sev = strtoupper((string)($lab['severity'] ?? 'NONE'));
            $g[$sev][] = trim((string)($r->text ?? ''));
        }

        $fmtList = function(array $arr, int $max=12){
            $arr = array_values(array_filter(array_unique(array_map('trim',$arr))));
            $view = array_slice($arr, 0, $max);
            $txt  = $view ? "  • ".implode("\n  • ", $view) : "  —";
            if (count($arr) > $max) $txt .= "\n  … (".(count($arr)-$max)." más)";
            return $txt;
        };

        $txt  = "Cláusulas/hallazgos del último análisis — **{$c->titulo}**\n";
        $txt .= "- Severidad ALTA:\n".$fmtList($g['HIGH'])."\n";
        $txt .= "- Severidad MEDIA:\n".$fmtList($g['MEDIUM'])."\n";
        $txt .= "- Severidad BAJA:\n".$fmtList($g['LOW'])."\n";
        return ['reply'=>$txt,'grounding'=>['type'=>'analysis','convenio_id'=>$c->id,'version_id'=>$an->version_id]];
    }

    private function answerConveniosUnaVersion(): array
    {
        $rows = DB::table('versiones_convenio')
            ->select('convenio_id', DB::raw('COUNT(*) as cnt'))
            ->groupBy('convenio_id')
            ->having('cnt','=',1)
            ->get();

        if ($rows->isEmpty()) return ['reply'=>'No hay convenios con una sola versión.','grounding'=>['type'=>'query','total'=>0]];

        $ids  = $rows->pluck('convenio_id')->all();
        $conv = DB::table('convenios')->select('id','titulo','fecha_vencimiento','estado')->whereIn('id',$ids)->orderBy('titulo')->get();

        $fmt = fn($d)=>$d ? Carbon::parse($d)->locale('es')->isoFormat('D [de] MMMM [de] YYYY') : '—';
        $txt = "Convenios con UNA sola versión:\n";
        foreach ($conv as $c) $txt .= "• {$c->titulo} — Vence: ".$fmt($c->fecha_vencimiento)." ({$c->estado})\n";
        return ['reply'=>$txt,'grounding'=>['type'=>'query','total'=>count($conv)]];
    }

    private function answerCantidadVersionesPorTitulo(string $needle): array
    {
        $c = $this->fuzzyFindConvenio($needle);
        if (!$c) return ['reply'=>"No encontré un convenio cuyo título se parezca a «{$this->sanitizeName($needle)}».",'grounding'=>['type'=>'query','total'=>0]];

        $n = (int) DB::table('versiones_convenio')->where('convenio_id',$c->id)->count();
        return ['reply'=>"El convenio **{$c->titulo}** tiene **{$n}** versión(es).",'grounding'=>['type'=>'convenio','id'=>$c->id]];
    }

    private function answerDescripcionConvenio(string $needle): array
    {
        $c = $this->fuzzyFindConvenio($needle);
        if (!$c) return ['reply'=>"No encontré un convenio cuyo título se parezca a «{$this->sanitizeName($needle)}».",'grounding'=>['type'=>'query','total'=>0]];
        $desc = trim((string)($c->descripcion ?? ''));
        if ($desc === '') $desc = '—';
        return ['reply'=>"Descripción de **{$c->titulo}**:\n{$desc}",'grounding'=>['type'=>'convenio','id'=>$c->id]];
    }

    private function answerContactoConvenio(string $needle): array
    {
        $c = $this->fuzzyFindConvenio($needle);
        if (!$c) return ['reply'=>"No encontré un convenio cuyo título se parezca a «{$this->sanitizeName($needle)}».",'grounding'=>['type'=>'query','total'=>0]];

        $cols = Schema::getColumnListing('convenios');
        $nameCol  = collect(['responsable','responsable_nombre','contacto','contacto_nombre','persona_contacto'])->first(fn($x)=>in_array($x,$cols,true));
        $mailCol  = collect(['responsable_email','contacto_email','correo_contacto','email_contacto'])->first(fn($x)=>in_array($x,$cols,true));
        $telCol   = collect(['responsable_telefono','contacto_telefono','telefono_contacto'])->first(fn($x)=>in_array($x,$cols,true));
        $areaCol  = collect(['area','unidad','dependencia'])->first(fn($x)=>in_array($x,$cols,true));

        $sel = ['id','titulo'];
        foreach ([$nameCol,$mailCol,$telCol,$areaCol] as $col) if ($col) $sel[] = $col;

        $row = DB::table('convenios')->select($sel)->where('id',$c->id)->first();

        $lines = ["Contacto de **{$c->titulo}**:"];
        $hasOne = false;
        if ($nameCol && !empty($row->{$nameCol})) { $lines[] = "- Responsable: {$row->{$nameCol}}"; $hasOne = true; }
        if ($areaCol && !empty($row->{$areaCol})) { $lines[] = "- Área/Unidad: {$row->{$areaCol}}"; $hasOne = true; }
        if ($mailCol && !empty($row->{$mailCol})) { $lines[] = "- Email: {$row->{$mailCol}}"; $hasOne = true; }
        if ($telCol  && !empty($row->{$telCol}))  { $lines[] = "- Teléfono: {$row->{$telCol}}"; $hasOne = true; }

        if (!$hasOne) $lines[] = "No hay datos de contacto registrados en el convenio.";
        return ['reply'=>implode("\n",$lines),'grounding'=>['type'=>'convenio','id'=>$c->id]];
    }

    private function answerDetalleConvenioPorTitulo(string $needle): array
    {
        $c = $this->fuzzyFindConvenio($needle);
        if (!$c) return ['reply'=>"No encontré un convenio cuyo título se parezca a «{$this->sanitizeName($needle)}».",'grounding'=>['type'=>'query','total'=>0]];

        $vers = DB::table('versiones_convenio')->where('convenio_id',$c->id)->orderByDesc('numero_version')->limit(10)->get();
        $risk = DB::table('analisis_riesgos')->where('convenio_id',$c->id)->orderByDesc('created_at')->first();

        $fmt = fn($d)=>$d ? Carbon::parse($d)->locale('es')->isoFormat('D [de] MMMM [de] YYYY') : '—';
        $txt = "Detalles del convenio **{$c->titulo}**\n- Estado: {$c->estado}\n- Fecha de Firma: ".$fmt($c->fecha_firma)."\n- Fecha de Vencimiento: ".$fmt($c->fecha_vencimiento)."\n";
        if ($risk) $txt .= "- Riesgo más reciente: {$risk->risk_level} (score ".number_format((float)$risk->score,3).")\n";
        if ($vers->count()) {
            $txt .= "- Versiones (máx. 10):\n";
            foreach ($vers as $v) $txt .= "  • v{$v->numero_version} (".$fmt($v->fecha_version).") — {$v->observaciones}\n";
        } else {
            $txt .= "- Aún no hay versiones registradas.\n";
        }
        return ['reply'=>$txt,'grounding'=>['type'=>'convenio','id'=>$c->id]];
    }

    private function answerVersionesPorTitulo(string $needle): array
    {
        $c = $this->fuzzyFindConvenio($needle);
        if (!$c) return ['reply'=>"No encontré un convenio cuyo título se parezca a «{$this->sanitizeName($needle)}».",'grounding'=>['type'=>'query','total'=>0]];

        $rows = DB::table('versiones_convenio')->where('convenio_id',$c->id)->orderByDesc('numero_version')->get();
        if ($rows->isEmpty()) return ['reply'=>"El convenio **{$c->titulo}** no tiene versiones registradas.",'grounding'=>['type'=>'convenio','id'=>$c->id]];

        $fmt = fn($d)=>$d ? Carbon::parse($d)->locale('es')->isoFormat('D [de] MMMM [de] YYYY') : '—';
        $txt = "Versiones del convenio **{$c->titulo}**:\n";
        foreach ($rows as $v) $txt .= "• v{$v->numero_version} (".$fmt($v->fecha_version).") — {$v->observaciones}\n";
        return ['reply'=>$txt,'grounding'=>['type'=>'convenio','id'=>$c->id,'versions'=>count($rows)]];
    }

    /* ----------- Contenido de versión (con /qa) ------------ */

    private function answerContenidoVersion(string $msg): array
    {
        $hint = $this->parseVersionHint($msg);

        // convenio (flex)
        $name = $this->extractConvenioMention($msg);
        if (!$name) {
            $only = DB::table('convenios')->select('id','titulo')->orderByDesc('updated_at')->limit(2)->get();
            if ($only->count() === 1) {
                $c = (object)['id'=>$only[0]->id,'titulo'=>$only[0]->titulo];
            } else {
                return ['reply'=>"Necesito el nombre del convenio. Ej.: «háblame del contenido de la versión inicial de mi convenio con BoA».",'grounding'=>['type'=>'ask']];
            }
        } else {
            $c = $this->fuzzyFindConvenio($name);
            if (!$c) return ['reply'=>"No encontré un convenio cuyo título se parezca a «{$this->sanitizeName($name)}».",'grounding'=>['type'=>'query','total'=>0]];
        }

        // versión
        $q = DB::table('versiones_convenio')->where('convenio_id',$c->id);
        if ($hint['type']==='num')        $v = $q->where('numero_version',$hint['num'])->first();
        elseif ($hint['type']==='inicial')$v = $q->orderBy('numero_version')->first();
        elseif ($hint['type']==='final')  $v = (clone $q)->whereRaw('LOWER(observaciones) LIKE ?',['%final%'])->orderByDesc('fecha_version')->first() ?: $q->orderByDesc('numero_version')->first();
        else                               $v = $q->orderByDesc('numero_version')->first();

        if (!$v) return ['reply'=>"No encontré versiones para **{$c->titulo}**.",'grounding'=>['type'=>'convenio','id'=>$c->id]];

        $texto = (string)($v->texto ?? '');
        if (trim($texto) === '') {
            return ['reply'=>"La versión v{$v->numero_version} de **{$c->titulo}** no tiene texto almacenado. Sube un PDF/DOCX legible para habilitar el análisis.",'grounding'=>['type'=>'version','convenio_id'=>$c->id,'version_id'=>$v->id]];
        }

        // Microservicio QA
        try {
            if ($this->semanticBase) {
                $client = new \GuzzleHttp\Client(['base_uri'=>$this->semanticBase,'timeout'=>15]);
                $payload = [
                    'question' => $msg,
                    'items' => [[
                        'convenio_id' => (int)$c->id,
                        'version_id'  => (int)$v->id,
                        'fragmento'   => mb_substr($texto,0,50000,'UTF-8'),
                        'tag'         => "v{$v->numero_version}"
                    ]]
                ];
                $res = $client->post('/qa', ['json'=>$payload]);
                $json = json_decode((string)$res->getBody(), true);
                if (!empty($json['answer'])) {
                    $ans = trim($json['answer']);
                    return ['reply'=>"**{$c->titulo} — v{$v->numero_version}**\n{$ans}", 'grounding'=>['type'=>'version','convenio_id'=>$c->id,'version_id'=>$v->id,'numero'=>$v->numero_version]];
                }
            }
        } catch (\Throwable $e) {
            // fallback
        }

        // Snippet
        $plain   = preg_replace("/\s+/", " ", strip_tags($texto));
        $snippet = mb_substr($plain, 0, 900, 'UTF-8');
        if (mb_strlen($plain,'UTF-8') > 900) $snippet .= " …";
        $reply = "Contenido de **{$c->titulo}** — v{$v->numero_version} ({$v->observaciones}):\n{$snippet}";
        return ['reply'=>$reply,'grounding'=>['type'=>'version','convenio_id'=>$c->id,'version_id'=>$v->id,'numero'=>$v->numero_version]];
    }

    private function answerContenidoConvenioUltimaVersion(string $msg): array
    {
        $name = $this->extractConvenioMention($msg);
        if (!$name) {
            $only = DB::table('convenios')->select('id','titulo')->orderByDesc('updated_at')->limit(2)->get();
            if ($only->count() === 1) {
                $c = (object)['id'=>$only[0]->id,'titulo'=>$only[0]->titulo];
            } else {
                return ['reply'=>"¿De qué convenio hablamos? Ej.: «analiza el contenido de mi convenio con BoA».",'grounding'=>['type'=>'ask']];
            }
        } else {
            $c = $this->fuzzyFindConvenio($name);
            if (!$c) return ['reply'=>"No encontré un convenio cuyo título se parezca a «{$this->sanitizeName($name)}».",'grounding'=>['type'=>'query','total'=>0]];
        }

        $v = DB::table('versiones_convenio')->where('convenio_id',$c->id)->orderByDesc('numero_version')->first();
        if (!$v) return ['reply'=>"El convenio **{$c->titulo}** aún no tiene versiones.","grounding"=>['type'=>'convenio','id'=>$c->id]];

        $msg2 = $msg.' (considera la última versión)';
        return $this->answerContenidoVersion("{$msg2} versión {$v->numero_version} del convenio {$c->titulo}");
    }

    /* ------------------- Notificaciones (autodetección tabla/cols) ---------------------- */

    private function answerNotificaciones(): array
    {
        $table = null;
        if (Schema::hasTable('notifications')) $table = 'notifications';
        elseif (Schema::hasTable('notificaciones')) $table = 'notificaciones';

        if (!$table) return ['reply'=>"No hay tabla de notificaciones en el sistema.",'grounding'=>['type'=>'query','total'=>0]];

        $cols = Schema::getColumnListing($table);
        $hasEstado   = in_array('estado',$cols,true);
        $hasMensaje  = in_array('mensaje',$cols,true);
        $hasTipo     = in_array('tipo',$cols,true);
        $hasConvenio = in_array('convenio_id',$cols,true);
        $hasAcciones = in_array('acciones',$cols,true);
        $hasLeido    = in_array('leido',$cols,true);

        $sel = ['id','created_at'];
        if ($hasTipo)     $sel[] = 'tipo';
        if ($hasEstado)   $sel[] = 'estado';
        if ($hasConvenio) $sel[] = 'convenio_id';
        if ($hasMensaje)  $sel[] = 'mensaje';
        if ($hasLeido)    $sel[] = 'leido';
        if ($hasAcciones) $sel[] = 'acciones';

        $rows = DB::table($table)->select($sel)->orderByDesc('created_at')->limit(50)->get();

        if ($rows->isEmpty()) return ['reply'=>"No hay notificaciones.","grounding"=>['type'=>'query','total'=>0]];

        $fmt = fn($d)=>Carbon::parse($d)->locale('es')->isoFormat('D [de] MMMM [de] YYYY');
        $txt = "Notificaciones (máx. 50):\n";
        foreach ($rows as $r) {
            $tipo  = $r->tipo     ?? 'EVENTO';
            $est   = $r->estado   ?? '—';
            $conv  = $r->convenio_id ?? '—';
            $msg   = $r->mensaje  ?? '';
            $flag  = isset($r->leido) ? ($r->leido ? 'LEÍDA' : 'NO LEÍDA') : '';
            $txt .= "• ".$fmt($r->created_at)." — {$tipo}";
            if ($est !== '—') $txt .= " — {$est}";
            if ($conv !== '—') $txt .= " — Convenio: {$conv}";
            if ($flag) $txt .= " — {$flag}";
            $txt .= "\n";
            if ($msg) $txt .= "  {$msg}\n";
        }
        return ['reply'=>$txt,'grounding'=>['type'=>'notifications','total'=>count($rows),'table'=>$table]];
    }

    /* ------------------- RAG + OLLAMA ---------------------- */

    private function buildGrounding(string $msg): array
    {
        $normTitulo = $this->normalizeForSql('titulo');
        $normDesc   = $this->normalizeForSql('descripcion');

        // usar tokens significativos del mensaje para levantar candidatos
        $tokens = $this->significantTokens($msg);
        $needle = '%'.implode('%',$tokens).'%';
        if ($needle === '%%') $needle = '%'.Str::lower($this->stripAccents($msg)).'%';

        $cands = DB::table('convenios')
            ->select('id','titulo','descripcion','estado','fecha_firma','fecha_vencimiento')
            ->where(function($q) use ($normTitulo,$normDesc,$needle){
                $q->whereRaw("$normTitulo LIKE ?",[$needle])
                  ->orWhereRaw("$normDesc LIKE ?",[$needle]);
            })
            ->orderByDesc('updated_at')->limit(5)->get();

        $ctxLines = [];
        foreach ($cands as $c) {
            $ctxLines[] = "CONVENIO #{$c->id} «{$c->titulo}» — estado: {$c->estado}; firma: {$c->fecha_firma}; vencimiento: {$c->fecha_vencimiento}";
            $vers = DB::table('versiones_convenio')->where('convenio_id',$c->id)->orderByDesc('numero_version')->limit(2)->get();
            foreach ($vers as $v) {
                $ctxLines[] = "  • v{$v->numero_version} — {$v->observaciones}";
                if (!empty($v->texto)) {
                    $ctxLines[] = "    Texto: ".mb_strimwidth(strip_tags((string)$v->texto), 0, 240, '…','UTF-8');
                }
            }
        }
        if (empty($ctxLines)) $ctxLines[] = "No hay coincidencias directas en títulos o descripciones.";

        return [
            'type' => 'rag',
            'context_text' => implode("\n", $ctxLines),
            'candidates' => $cands->pluck('id')->all(),
        ];
    }

    private function askOllama(string $userMsg, string $contextText): string
    {
        $system = <<<SYS
Eres un asistente experto en gestión de convenios. Responde SIEMPRE en español, claro y conciso.
Usa EXCLUSIVAMENTE la información del contexto y consultas a la base de datos (ya incorporadas en el mensaje del sistema).
Si no hay datos suficientes, di: "No tengo esa información en el sistema" y sugiere qué dato pedir (ej.: nombre exacto del convenio).
No inventes fuentes ni datos. Formatea con viñetas al listar.
Contexto:
{$contextText}
SYS;

        $payload = [
            'model'    => $this->ollamaModel,
            'stream'   => false,
            'messages' => [
                ['role'=>'system','content'=>$system],
                ['role'=>'user','content'=>$userMsg],
            ],
            'options'  => [
                'temperature'=>0.2,
                'num_ctx'=>2048,
            ],
        ];

        $client = new \GuzzleHttp\Client(['base_uri'=>$this->ollamaUrl,'timeout'=>$this->ollamaTimeout]);
        $resp   = $client->post('/api/chat', ['json'=>$payload]);
        $json   = json_decode((string)$resp->getBody(), true);
        $reply  = $json['message']['content'] ?? null;
        return $reply ? trim($reply) : 'No pude generar una respuesta.';
    }
}