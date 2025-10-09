// src/pages/ConvenioRiesgo.jsx
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import api from "../api";

/* ================= helpers UI ================= */
const RISK = {
  ALTO:  { bg: "#991b1b", fg: "#fff", label: "ALTO"  },
  MEDIO: { bg: "#92400e", fg: "#fff", label: "MEDIO" },
  BAJO:  { bg: "#065f46", fg: "#fff", label: "BAJO"  },
  DEFAULT: { bg: "#374151", fg: "#fff", label: "—"  }
};
const levelStyle = (lvl) => RISK[lvl] || RISK.DEFAULT;

const BTN = {
  back:   { background:"#374151", borderColor:"#4b5563", color:"#e5e7eb" },
  primary:{ background:"#1a6779", borderColor:"#125463", color:"#fff" },
  neutral:{ background:"#111827", borderColor:"#1f2937", color:"#e5e7eb" },
  danger: { background:"#dc2626", borderColor:"#b91c1c", color:"#fff" },
  info:   { background:"#0ea5e9", borderColor:"#0284c7", color:"#fff" },
  disabled:{ opacity:.6, cursor:"not-allowed" }
};

/* ================= helpers de texto ================= */
const normalize = (s="") => s.replace(/\r/g,"").replace(/[ \t]+\n/g,"\n").trim();

function escapeHtml(s="") {
  return s.replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
}
const highlight = (text, tokens) => {
  if (!text) return { __html: "" };
  if (!tokens?.length) return { __html: escapeHtml(text) };
  let html = escapeHtml(text);
  const uniq = [...new Set(tokens.filter(Boolean))];
  uniq.forEach(t => {
    const safe = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(${safe})`, "gi");
    html = html.replace(re, '<mark style="background:#f59e0b;color:#111827;border-radius:3px;padding:0 2px">$1</mark>');
  });
  return { __html: html };
};

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

function makeSnippets(text="", tokens=[], max=15) {
  if (!text || !tokens?.length) return [];
  const uniq = [...new Set(tokens.filter(Boolean))];
  const out = [];
  const lower = text.toLowerCase();
  uniq.forEach(tok => {
    const t = tok.toLowerCase();
    let idx = 0; let safe = 0;
    while (safe < 500) {
      const pos = lower.indexOf(t, idx);
      if (pos === -1) break;
      const start = Math.max(0, lower.lastIndexOf("\n", pos-1) !== -1 ? lower.lastIndexOf("\n", pos-1) : pos-120);
      const end   = Math.min(text.length, lower.indexOf("\n", pos+t.length) !== -1 ? lower.indexOf("\n", pos+t.length) : pos+t.length+160);
      const raw   = text.slice(start, end).trim();
      out.push({ token: tok, raw });
      idx = pos + t.length;
      safe++;
      if (out.length >= max) break;
    }
  });
  const seen = new Set();
  return out.filter(s => {
    const k = s.token + "||" + s.raw;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
function matchDensity(text="", tokens=[]) {
  if (!text || !tokens?.length) return 0;
  const uniq = [...new Set(tokens.filter(Boolean))];
  let total = 0; uniq.forEach(t => { total += t.length; });
  return Math.min(1, total / Math.max(1, text.length));
}

/* ================= página ================= */
export default function ConvenioRiesgo(){
  const { id } = useParams();

  const [conv, setConv] = useState(null);
  const [versiones, setVersiones] = useState([]);  // siempre array
  const [sel, setSel] = useState("");              // id versión seleccionada
  const [texto, setTexto] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  // resultado del análisis
  const [result, setResult] = useState(null);

  // UI extras
  const [onlyMatches, setOnlyMatches] = useState(false);
  const [q, setQ] = useState("");

  // --- carga convenio + versiones (normaliza paginado -> array) ---
  const load = useCallback(async () => {
    const [a, b] = await Promise.all([
      api.get(`/convenios/${id}`),
      // pedimos varias por si el backend pagina; igualmente normalizamos
      api.get(`/convenios/${id}/versiones`, { params: { per_page: 100 } }),
    ]);
    setConv(a.data);
    const arr = Array.isArray(b.data) ? b.data : (b.data?.data || []);
    setVersiones(arr);
    if (arr.length) setSel(String(arr[0].id));
  }, [id]);

  useEffect(()=>{ load(); }, [load]);

  // Cargar texto de la versión
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

  useEffect(()=>{ if (sel) loadText(sel); }, [sel, loadText]);

  // Analizar
  const analizar = async () => {
    setErr(""); setResult(null);
    if (!texto.trim()) { setErr("No hay texto en esta versión para analizar."); return; }
    try {
      setLoading(true);
      const { data } = await api.post("/analisis/riesgo", { text: texto });
      setResult(data || null);
    } catch (e) {
      setErr(e.response?.data?.message || "No se pudo analizar el texto.");
    } finally {
      setLoading(false);
    }
  };

  /* ====== derivados para UI ====== */
  const matches = useMemo(() => (result?.matches || []).map(m=>m.token).filter(Boolean), [result]);
  const tokenTable = useMemo(() => countTokens(matches), [matches]);
  const snippets = useMemo(() => makeSnippets(texto, matches, 20), [texto, matches]);
  const density = useMemo(() => matchDensity(texto, matches), [texto, matches]);

  const filteredPreview = useMemo(()=>{
    if (!onlyMatches || !matches?.length) return texto;
    return texto
      .split(/\n+/)
      .filter(line => matches.some(t => line.toLowerCase().includes(t.toLowerCase())))
      .join("\n");
  }, [texto, onlyMatches, matches]);

  const copyResumen = async () => {
    const lvl = result?.risk_level || "—";
    const score = result?.score ?? 0;
    const vObj = versiones.find(v=>String(v.id)===String(sel));
    const lines = [
      `Convenio: ${conv?.titulo || id}`,
      `Versión: v${vObj?.numero_version || "—"}`,
      `Nivel de riesgo: ${lvl}`,
      `Score (0-1): ${Math.round(score*100)/100}`,
      `Coincidencias: ${matches.length}`,
      `Densidad aproximada: ${(density*100).toFixed(1)}%`,
    ];
    try { await navigator.clipboard.writeText(lines.join("\n")); alert("Resumen copiado."); }
    catch { alert("No se pudo copiar."); }
  };

  const exportJSON = () => {
    const payload = {
      convenio: { id, titulo: conv?.titulo },
      version: versiones.find(v=>String(v.id)===String(sel)) || null,
      analysis: result,
      tokens: tokenTable,
      density,
      snippets
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `riesgo_convenio_${id}_v${payload.version?.numero_version || "x"}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  /* ====== render ====== */
  const lvl = levelStyle(result?.risk_level);
  const scorePct = Math.max(0, Math.min(1, Number(result?.score ?? 0))) * 100;

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
        <div style={{marginLeft:"auto", display:"flex", gap:8, alignItems:"center"}}>
          <input placeholder="Buscar en texto…" value={q} onChange={e=>setQ(e.target.value)} style={{minWidth:220}} />
          <label style={{display:"flex", alignItems:"center", gap:6}}>
            <input type="checkbox" checked={onlyMatches} onChange={e=>setOnlyMatches(e.target.checked)} />
            Solo coincidencias
          </label>
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
              <span className="pill">Coincidencias: {matches.length}</span>
              <span className="pill">Densidad: {(density*100).toFixed(1)}%</span>
            </div>

            <div style={{marginTop:10}}>
              <div style={{display:"flex", alignItems:"center", justifyContent:"space-between"}}>
                <span style={{opacity:.9}}>Score (0–1)</span>
                <b>{(scorePct/100).toFixed(2)}</b>
              </div>
              <div style={{height:10, background:"#111827", borderRadius:999, marginTop:6}}>
                <div style={{
                  width:`${scorePct}%`,
                  height:"100%",
                  background:lvl.bg,
                  borderRadius:999,
                  transition:"width .2s"
                }}/>
              </div>
            </div>

            <div style={{marginTop:10, display:"flex", gap:8, flexWrap:"wrap"}}>
              <button className="btn" style={BTN.neutral} onClick={copyResumen}>Copiar resumen</button>
              <button className="btn" style={BTN.info} onClick={exportJSON} disabled={!result}>Exportar JSON</button>
            </div>
          </div>

          <div>
            <div style={{fontWeight:600, marginBottom:6}}>Palabras clave detectadas</div>
            {tokenTable.length === 0 ? (
              <div style={{opacity:.8}}>—</div>
            ) : (
              <div style={{display:"flex", gap:8, flexWrap:"wrap"}}>
                {tokenTable.map(k => (
                  <span key={k.token} style={{background:"#111827", padding:"4px 8px", borderRadius:8}}>
                    {k.token} <span style={{opacity:.7}}>×{k.count}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
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
            {snippets.map((s,i)=>(
              <div key={i} style={{border:"1px solid rgba(255,255,255,.08)", borderRadius:8, padding:10, background:"rgba(0,0,0,.25)"}}>
                <div style={{fontSize:12, opacity:.8, marginBottom:4}}>#{i+1} · {s.token}</div>
                <div dangerouslySetInnerHTML={highlight(s.raw, [s.token])}/>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* texto analizado */}
      <div className="card" style={{marginTop:10}}>
        <h3 style={{margin:0, fontSize:16}}>Texto analizado</h3>
        <div style={{maxHeight:420, overflow:"auto", marginTop:8, padding:10, border:"1px solid rgba(255,255,255,.08)", borderRadius:8, background:"rgba(0,0,0,.15)", whiteSpace:"pre-wrap", fontFamily:"ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", fontSize:13}}>
          {q
            ? <div dangerouslySetInnerHTML={highlight(filteredPreview, [q, ...matches])}/>
            : <div dangerouslySetInnerHTML={highlight(filteredPreview, matches)}/>
          }
        </div>
      </div>
    </div>
  );
}