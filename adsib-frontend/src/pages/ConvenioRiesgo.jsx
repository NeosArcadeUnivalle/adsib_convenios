// resources/js/pages/ConvenioRiesgo.jsx

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import api from "../api";

/* =================== Paletas =================== */

const RISK = {
  ALTO:    { bg: "#991b1b", fg: "#fff", label: "ALTO"  },
  MEDIO:   { bg: "#92400e", fg: "#fff", label: "MEDIO" },
  BAJO:    { bg: "#065f46", fg: "#fff", label: "BAJO"  },
  DEFAULT: { bg: "#374151", fg: "#fff", label: "—"     }
};
const levelStyle = (lvl) => RISK[lvl] || RISK.DEFAULT;

const SEV = {
  HIGH:   { bg: "#dc2626", fg: "#fff", label: "ALTO" },
  MEDIUM: { bg: "#f59e0b", fg: "#111827", label: "MEDIO" },
  LOW:    { bg: "#10b981", fg: "#0b2f26", label: "BAJO" },
  NONE:   { bg: "#6b7280", fg: "#fff", label: "N/A" }
};

const SEMANTIC = { bg: "#60a5fa", fg: "#0b213c", ring: "rgba(96,165,250,.35)" };

const BTN = {
  back:     { background:"#374151", borderColor:"#4b5563", color:"#e5e7eb" },
  primary:  { background:"#1a6779", borderColor:"#125463", color:"#fff" },
  neutral:  { background:"#111827", borderColor:"#1f2937", color:"#e5e7eb" },
  disabled: { opacity:.6, cursor:"not-allowed" }
};

/* =================== helpers =================== */

const normalize = (s="") => s.replace(/\r/g,"").replace(/[ \t]+\n/g,"\n").trim();
const esc = (s="") => s.replace(/[&<>"']/g, (m) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[m]));
const stripAccents = (s="") => s.normalize?.("NFD").replace(/[\u0300-\u036f]/g,"") ?? s;

const styleFromMatch = (m) => {
  const sev = (m?.severity || "NONE").toUpperCase();
  if (m?.source === "semantic") {
    return { bg: SEMANTIC.bg, fg: SEMANTIC.fg, ring: SEMANTIC.ring, kind:"semantic", severity: sev };
  }
  return { ...(SEV[sev] || SEV.NONE), kind:"rule", severity: sev };
};

/** Mapa token -> estilo. Anticipación manda sobre reglas. */
function buildTokenStyles(matches=[]) {
  const map = new Map();
  const rank = { HIGH:3, MEDIUM:2, LOW:1, NONE:0 };

  const put = (key, base) => {
    const prev = map.get(key);
    if (!prev) { map.set(key, base); return; }
    if (base.kind === "semantic" && prev.kind !== "semantic") { map.set(key, base); return; }
    if (prev.kind === "semantic" && base.kind !== "semantic") { return; }
    if (rank[base.severity] > rank[prev.severity]) map.set(key, base);
  };

  matches.forEach(m => {
    const token = (m.token || "").trim(); if (!token) return;
    const base = styleFromMatch(m);
    const k1 = token.toLowerCase();
    const k2 = stripAccents(k1);
    put(k1, base); if (k2 !== k1) put(k2, base);
  });

  return map;
}

/** Fragmentos a partir de matches (mantienen su estilo). */
function makeSnippetsFromMatches(text="", matches=[], max=24) {
  const out = [];
  const lowerNoAcc = stripAccents(text.toLowerCase());
  const seen = new Set();

  for (const m of matches || []) {
    const tok = (m.token || "").trim(); if (!tok) continue;
    const t = stripAccents(tok.toLowerCase());
    const pos = lowerNoAcc.indexOf(t);
    if (pos === -1) continue;

    const start = Math.max(0, lowerNoAcc.lastIndexOf("\n", pos-1) !== -1 ? lowerNoAcc.lastIndexOf("\n", pos-1) : pos-120);
    const end   = Math.min(text.length, lowerNoAcc.indexOf("\n", pos+t.length) !== -1 ? lowerNoAcc.indexOf("\n", pos+t.length) : pos+t.length+160);
    const raw   = text.slice(start, end).trim();

    const key = tok.toLowerCase() + "||" + raw;
    if (seen.has(key)) continue; seen.add(key);

    out.push({ token: tok, raw, style: styleFromMatch(m) });
    if (out.length >= max) break;
  }
  return out;
}

const countTokens = (tokens=[]) => {
  const map = new Map();
  tokens.forEach(t => {
    const k = (t||"").trim().toLowerCase();
    if (!k) return;
    map.set(k, (map.get(k)||0)+1);
  });
  return [...map.entries()]
    .map(([token, count]) => ({ token, count }))
    .sort((a,b)=> b.count - a.count || a.token.localeCompare(b.token));
};

function matchDensity(text="", tokens=[]) {
  if (!text || !tokens?.length) return 0;
  const uniq = [...new Set(tokens.filter(Boolean))];
  let total = 0; uniq.forEach(t => { total += t.length; });
  return Math.min(1, total / Math.max(1, text.length));
}

/* ==== Highlighter por rangos (usa matches) ==== */

/** Genera HTML resaltado combinando coincidencias con prioridad (semantic > reglas). */
function highlightByMatches(text="", matches=[], extraQuery="") {
  if (!text) return { __html: "" };

  const n = text.length;
  if (n === 0) return { __html: "" };

  // string sin acentos para buscar
  const noAcc = stripAccents(text);
  const sevRank = { HIGH:3, MEDIUM:2, LOW:1, NONE:0 };
  const prio = (st) => st.kind === "semantic" ? 100 + sevRank[st.severity || "NONE"] : (st.kind === "extra" ? 0 : sevRank[st.severity || "NONE"]);

  // construir rangos en índices del string original
  const ranges = [];
  const pushToken = (tok, st) => {
    if (!tok) return;
    const t = stripAccents(tok.toLowerCase());
    if (!t) return;
    let idx = 0;
    while (idx < noAcc.length) {
      const p = noAcc.toLowerCase().indexOf(t, idx);
      if (p === -1) break;
      const s = p;
      const e = p + t.length;
      if (e > s) ranges.push({ start:s, end:e, style: st });
      idx = p + t.length;
    }
  };

  (matches || []).forEach(m => pushToken(m.token, styleFromMatch(m)));
  if (extraQuery) {
    const st = { bg:"#fef3c7", fg:"#111827", kind:"extra", severity:"NONE" };
    pushToken(extraQuery, st);
  }

  if (ranges.length === 0) return { __html: esc(text) };

  // ordenar por prioridad y longitud
  ranges.sort((a,b)=>{
    const pa = prio(a.style), pb = prio(b.style);
    if (pb !== pa) return pb - pa;
    const la = (a.end - a.start), lb = (b.end - b.start);
    return lb - la || a.start - b.start;
  });

  // capa de estilos por carácter (prioridad primero)
  const layer = new Array(n).fill(null);
  for (const r of ranges) {
    for (let i = Math.max(0, r.start); i < Math.min(n, r.end); i++) {
      if (layer[i] == null) layer[i] = r.style;
    }
  }

  // construir HTML
  let html = "";
  let open = null;
  const openTag = (st) => {
    const ring = st.ring ? `;box-shadow:0 0 0 2px ${st.ring} inset` : "";
    return `<mark style="background:${st.bg};color:${st.fg};border-radius:4px;padding:0 2px${ring}">`;
  };

  for (let i=0;i<n;i++) {
    const st = layer[i];
    if (st !== open) {
      if (open) html += "</mark>";
      if (st) html += openTag(st);
      open = st;
    }
    html += esc(text[i]);
  }
  if (open) html += "</mark>";

  return { __html: html };
}

/* ===== Helpers amigables para historial ===== */
const modelFriendly = (m = "") => {
  const x = (m || "").toLowerCase();
  if (x.includes("tfidf")) return "búsqueda semántica (TF-IDF)";
  if (x.includes("mini") || x.includes("mpnet") || x.includes("paraphrase")) return "modelo de similitud (frases)";
  if (x.includes("openai") || x.includes("text-embedding") || x.includes("e5")) return "embeddings avanzados";
  if (x.includes("rules")) return "reglas (palabras clave)";
  return m || "motor desconocido";
};
const fmtPct   = (n) => (Math.max(0, Math.min(1, Number(n ?? 0))) * 100).toFixed(0) + "%";
const fmtFecha = (s) => { try { return new Date(s).toLocaleString(); } catch { return s || "—"; } };

/* =================== Página =================== */

export default function ConvenioRiesgo(){
  const { id } = useParams();

  const [conv, setConv] = useState(null);
  const [versiones, setVersiones] = useState([]);
  const [sel, setSel] = useState("");
  const [texto, setTexto] = useState("");

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const [result, setResult] = useState(null);
  const [history, setHistory] = useState([]);
  const [page, setPage] = useState(1);
  const [histMeta, setHistMeta] = useState({ page: 1, per: 5, total: 0 });

  const [q, setQ] = useState("");

  // ----- carga convenio + versiones -----
  const load = useCallback(async () => {
    const [a, b] = await Promise.all([
      api.get(`/convenios/${id}`),
      api.get(`/convenios/${id}/versiones`, { params: { per_page: 100 } }),
    ]);
    setConv(a.data);
    const arr = Array.isArray(b.data) ? b.data : (b.data?.data || []);
    setVersiones(arr);
    if (arr.length) setSel(String(arr[0].id));
  }, [id]);

  useEffect(()=>{ load(); }, [load]);

  const loadText = useCallback(async (vid) => {
    setErr(""); setTexto(""); setResult(null);
    if (!vid) return;
    try {
      setLoading(true);
      const { data } = await api.get(`/versiones/${vid}/texto`);
      setTexto(normalize(data?.text || ""));
    } catch (e) {
      setErr(e.response?.data?.message || "No se pudo extraer el texto de la versión.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadHistory = useCallback(async (p = 1) => {
    if (!conv?.id) return;
    try {
      const { data } = await api.get('/analisis', {
        params: { convenio_id: conv.id, page: p, per: 5 }
      });
      const items = Array.isArray(data?.data) ? data.data : [];
      setHistory(items);
      setHistMeta({
        page: data?.meta?.page || p,
        per:  data?.meta?.per  || 5,
        total: data?.meta?.total || 0
      });
      setPage(data?.meta?.page || p);
    } catch { /* silencio */ }
  }, [conv?.id]);

  useEffect(() => {
    if (sel) {
      loadText(sel);
      loadHistory(1);
    }
  }, [sel, loadText, loadHistory]);

  const analizar = useCallback(async () => {
    setErr(""); setResult(null);
    if (!texto.trim()) { setErr("No hay texto en esta versión para analizar."); return; }
    try {
      setLoading(true);
      const { data } = await api.post("/analisis/riesgo", {
        text: texto,
        version_id: sel,
        convenio_id: conv?.id,
      });
      setResult(data || null);
      await loadHistory(1);
    } catch (e) {
      setErr(e.response?.data?.message || "No se pudo analizar el texto.");
    } finally {
      setLoading(false);
    }
  }, [texto, sel, conv?.id, loadHistory]);

  /* ====== derivados para UI ====== */
  const matchesFull = useMemo(() => result?.matches || [], [result]);
  const tokenStyles = useMemo(() => buildTokenStyles(matchesFull), [matchesFull]);

  const allTokens      = useMemo(() => [...tokenStyles.keys()], [tokenStyles]);
  const semanticTokens = useMemo(
    () => matchesFull.filter(m=>m.source==="semantic").map(m=>stripAccents((m.token||"").toLowerCase())),
    [matchesFull]
  );
  const ruleTokens     = useMemo(
    () => matchesFull.filter(m=>m.source!=="semantic").map(m=>stripAccents((m.token||"").toLowerCase())),
    [matchesFull]
  );

  const tokenTable = useMemo(() => countTokens(allTokens), [allTokens]);
  const snippets   = useMemo(() => makeSnippetsFromMatches(texto, matchesFull, 24), [texto, matchesFull]);
  const density    = useMemo(() => matchDensity(texto, allTokens), [texto, allTokens]);

  // Copiar resumen (se define DESPUÉS de tener los memos para evitar "no-undef")
  const copyResumen = useCallback(async () => {
    const lvl = result?.risk_level || "—";
    const score = result?.score ?? 0;
    const vObj = (versiones || []).find(v=>String(v.id)===String(sel));
    const lines = [
      `Convenio: ${conv?.titulo || id}`,
      `Versión: v${vObj?.numero_version || "—"}`,
      `Nivel de riesgo: ${lvl}`,
      `Confianza: ${(Math.max(0, Math.min(1, score)) * 100).toFixed(0)}%`,
      `Detectadas en lista: ${ruleTokens.length}`,
      `Anticipaciones del modelo: ${semanticTokens.length}`,
      `Densidad aproximada: ${(density*100).toFixed(1)}%`,
    ];
    try { await navigator.clipboard.writeText(lines.join("\n")); alert("Resumen copiado."); }
    catch { alert("No se pudo copiar."); }
  }, [result, versiones, sel, conv?.titulo, id, ruleTokens.length, semanticTokens.length, density]);

  /* ====== render ====== */
  const lvl = levelStyle(result?.risk_level);
  const scorePct = Math.max(0, Math.min(1, Number(result?.score ?? 0))) * 100;
  const totalPages = Math.max(1, Math.ceil((histMeta.total || 0) / (histMeta.per || 5)));

  return (
    <div className="card" style={{ padding: 20 }}>
      {/* header */}
      <div style={{display:"flex", alignItems:"center", gap:10, flexWrap:"wrap", marginBottom:6}}>
        <Link to={`/convenios/${id}`} className="btn" style={BTN.back}>Volver al convenio</Link>
        <h2 style={{margin:0}}>Análisis de riesgo — {conv?.titulo || "..."}</h2>
      </div>

      {/* filtros */}
      <div className="card" style={{display:"flex", gap:10, alignItems:"center", flexWrap:"wrap"}}>
        <label>Versión:</label>
        <select value={sel} onChange={e=>setSel(e.target.value)}>
          {(versiones || []).map(v => <option key={v.id} value={v.id}>v{v.numero_version}</option>)}
        </select>
        <button className="btn" style={{...BTN.primary, ...(loading ? BTN.disabled: {})}} disabled={loading} onClick={analizar}>
          {loading ? "Analizando..." : "Analizar"}
        </button>

        <div style={{marginLeft:"auto", display:"flex", gap:12, alignItems:"center"}}>
          <div style={{display:"flex", gap:8, alignItems:"center", fontSize:12, opacity:.9}}>
            <span style={{background:SEV.HIGH.bg, color:SEV.HIGH.fg, padding:"2px 6px", borderRadius:6}}>directo ALTO</span>
            <span style={{background:SEV.MEDIUM.bg, color:SEV.MEDIUM.fg, padding:"2px 6px", borderRadius:6}}>directo MEDIO</span>
            <span style={{background:SEV.LOW.bg, color:SEV.LOW.fg, padding:"2px 6px", borderRadius:6}}>directo BAJO</span>
            <span style={{background:SEMANTIC.bg, color:SEMANTIC.fg, padding:"2px 6px", borderRadius:6}}>anticipación</span>
          </div>
          <input placeholder="Buscar en texto…" value={q} onChange={e=>setQ(e.target.value)} style={{minWidth:240}} />
        </div>
      </div>

      {err && <div className="card" style={{marginTop:8, borderColor:"#b91c1c", color:"#fee2e2", background:"#7f1d1d"}}>{err}</div>}

      {/* resumen */}
      <div className="card" style={{marginTop:10}}>
        <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:14}}>
          <div>
            <div style={{display:"flex", gap:8, alignItems:"center", flexWrap:"wrap"}}>
              <span style={{ padding:"6px 12px", borderRadius:8, background:lvl.bg, color:lvl.fg, fontWeight:700 }}>
                Nivel: {lvl.label}
              </span>
              <span className="pill">Directos: {ruleTokens.length}</span>
              <span className="pill">Anticipaciones: {semanticTokens.length}</span>
              <span className="pill">Densidad: {(density*100).toFixed(1)}%</span>
            </div>

            <div style={{marginTop:10}}>
              <div style={{display:"flex", alignItems:"center", justifyContent:"space-between"}}>
                <span style={{opacity:.9}}>Confianza</span>
                <b>{(scorePct/100).toFixed(2)}</b>
              </div>
              <div style={{height:10, background:"#111827", borderRadius:999, marginTop:6}}>
                <div style={{ width:`${scorePct}%`, height:"100%", background:lvl.bg, borderRadius:999, transition:"width .2s" }}/>
              </div>
            </div>

            <div style={{marginTop:10, display:"flex", gap:8, flexWrap:"wrap"}}>
              <button className="btn" style={BTN.neutral} onClick={copyResumen}>Copiar resumen</button>
            </div>
          </div>

          {/* chips */}
          <div>
            <div style={{fontWeight:600, marginBottom:6}}>Palabras/expresiones detectadas</div>
            {tokenTable.length === 0 ? (
              <div style={{opacity:.8}}>—</div>
            ) : (
              <div style={{display:"flex", gap:8, flexWrap:"wrap"}}>
                {tokenTable.map(k => {
                  const st = tokenStyles.get(k.token) || { bg:"#111827", fg:"#e5e7eb" };
                  const chipStyle = { background: st.bg, color: st.fg, padding:"4px 8px", borderRadius:8, display:"inline-flex", alignItems:"center", gap:6 };
                  const label = st.kind === "semantic" ? "anticipación" : (SEV[st.severity]?.label || "N/A");
                  return (
                    <span key={k.token} style={chipStyle}>
                      {k.token} <span style={{opacity:.9}}>×{k.count}</span>
                      <span style={{background:"rgba(0,0,0,.18)", padding:"0 6px", borderRadius:6, fontSize:11}}>{label}</span>
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* HISTORIAL */}
      <div className="card" style={{marginTop:10}}>
        <div style={{display:"flex", justifyContent:"space-between", alignItems:"center"}}>
          <h3 style={{margin:0, fontSize:16}}>Historial de análisis</h3>
        </div>

        {history.length === 0 ? (
          <div style={{opacity:.8, marginTop:8}}>Aún no hay análisis registrados para este convenio.</div>
        ) : (
          <>
            <div style={{marginTop:10, display:"grid", gap:10}}>
              {history.map((h) => {
                const fecha = fmtFecha(h.analizado_en || h.created_at);
                const lvlH  = levelStyle(h.risk_level);
                const confianza = fmtPct(h.score);
                const hallazgos = h.matches ?? 0;
                const motor = modelFriendly(h.modelo);

                return (
                  <div key={h.id}
                    style={{
                      display:"grid",
                      gridTemplateColumns:"180px 1fr",
                      gap:12,
                      padding:12,
                      border:"1px solid rgba(255,255,255,.08)",
                      borderRadius:10,
                      background:"rgba(0,0,0,.25)"
                    }}
                  >
                    <div>
                      <div style={{opacity:.8, fontSize:12}}>{fecha}</div>
                      <div style={{marginTop:6, display:"inline-block", padding:"6px 10px",
                        borderRadius:8, background:lvlH.bg, color:lvlH.fg, fontWeight:700}}>
                        Riesgo: {lvlH.label}
                      </div>
                    </div>

                    <div style={{display:"flex", flexWrap:"wrap", gap:10, alignItems:"center"}}>
                      <span className="pill">Confianza: <b>{confianza}</b></span>
                      <span className="pill">Hallazgos totales: <b>{hallazgos}</b></span>
                      <span className="pill">Método: <b>{motor}</b></span>
                      <div style={{minWidth:160, flex:"0 0 auto"}}>
                        <div style={{opacity:.8, fontSize:12, marginBottom:4}}>Nivel de confianza</div>
                        <div style={{height:8, background:"#111827", borderRadius:999}}>
                          <div style={{ width: confianza, height:"100%", background:lvlH.bg, borderRadius:999 }}/>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{display:'flex', justifyContent:'center', gap:12, marginTop:12, alignItems:'center'}}>
              <button className="btn" style={BTN.neutral} onClick={() => loadHistory(page - 1)} disabled={!(page>1)}>◀ Anterior</button>
              <span style={{opacity:.8}}>Página {page} de {totalPages}</span>
              <button className="btn" style={BTN.neutral} onClick={() => loadHistory(page + 1)} disabled={!(page < totalPages)}>Siguiente ▶</button>
            </div>
          </>
        )}
      </div>

      {/* fragmentos relevantes */}
      <div className="card" style={{marginTop:10}}>
        <div style={{display:"flex", alignItems:"center", justifyContent:"space-between"}}>
          <h3 style={{margin:0, fontSize:16}}>Fragmentos relevantes</h3>
          <span style={{opacity:.8}}>{snippets.length} fragmentos</span>
        </div>

        {snippets.length === 0 ? (
          <div style={{opacity:.8, marginTop:6}}>No se detectaron fragmentos relevantes.</div>
        ) : (
          <div style={{display:"grid", gap:8, marginTop:8}}>
            {snippets.map((s,i)=>{
              const st = s.style || { bg:"#111827", fg:"#e5e7eb", kind:"rule", severity:"NONE" };
              const isSemantic = st.kind === "semantic";
              const border = isSemantic ? `0 0 0 2px ${SEMANTIC.ring} inset` : "none";

              // Resaltar SOLO el token del fragmento con su estilo propio
              const localHtml = highlightByMatches(
                s.raw,
                [{ token: s.token, source: isSemantic ? "semantic" : "rule", severity: st.severity }]
              ).__html;

              return (
                <div key={i} style={{
                  border:"1px solid rgba(255,255,255,.08)",
                  borderRadius:8,
                  padding:10,
                  background:"rgba(0,0,0,.25)",
                  boxShadow: border
                }}>
                  <div style={{fontSize:12, opacity:.9, marginBottom:6, display:"flex", gap:8, alignItems:"center"}}>
                    #{i+1} · {s.token}
                    <span style={{background: st.bg, color: st.fg, borderRadius:6, padding:"2px 6px", fontSize:11}}>
                      {isSemantic ? "anticipación" : (SEV[st.severity]?.label || "N/A")}
                    </span>
                  </div>
                  <div dangerouslySetInnerHTML={{ __html: localHtml }} />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* texto analizado */}
      <div className="card" style={{marginTop:10}}>
        <h3 style={{margin:0, fontSize:16}}>Texto analizado</h3>
        <div style={{
          maxHeight:420, overflow:"auto", marginTop:8, padding:10,
          border:"1px solid rgba(255,255,255,.08)", borderRadius:8,
          background:"rgba(0,0,0,.15)", whiteSpace:"pre-wrap",
          fontFamily:"ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", fontSize:13
        }}>
          <div
            dangerouslySetInnerHTML={highlightByMatches(
              texto,
              matchesFull,
              q
            )}
          />
        </div>
      </div>
    </div>
  );
}