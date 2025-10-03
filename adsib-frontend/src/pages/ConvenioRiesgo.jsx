import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import api from "../api";

/* ==== estilos y helpers ==== */
const RISK = {
  ALTO:  { bg:"#7f1d1d", fg:"#fff", title:"ALTO",  msg:"Se detectan indicios sensibles. Revisión obligatoria." },
  MEDIO: { bg:"#78350f", fg:"#fff", title:"MEDIO", msg:"Hay términos que requieren atención y validación." },
  BAJO:  { bg:"#065f46", fg:"#fff", title:"BAJO",  msg:"Sin señales relevantes." },
  DEFAULT:{ bg:"#374151", fg:"#fff", title:"—",    msg:"Ejecuta el análisis para ver el resultado." }
};
const SEV_COL = {
  HIGH:  { bg:"#b91c1c", fg:"#fff" },
  MEDIUM:{ bg:"#f59e0b", fg:"#111827" },
  LOW:   { bg:"#10b981", fg:"#062b24" },
};
const BTN = {
  back:{ background:"#374151", borderColor:"#4b5563", color:"#e5e7eb" },
  primary:{ background:"#1a6779", borderColor:"#125463", color:"#fff" },
  neutral:{ background:"#111827", borderColor:"#1f2937", color:"#e5e7eb" },
  info:{ background:"#0ea5e9", borderColor:"#0284c7", color:"#fff" },
  disabled:{ opacity:.6, cursor:"not-allowed" }
};

const escapeHtml = (s="") => s.replace(/[&<>"']/g, m => (
  { "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[m]
));
const norm = (s="") => s.replace(/\r/g,"");

const PAGE_RE = /(p[áa]gina|page)\s+(\d+)/i;

/* indexa texto en líneas y páginas (como comparador) */
function indexText(text="") {
  const lines = norm(text).split("\n");
  const out = [];
  let page = 1;
  let offset = 0;
  for (let i=0; i<lines.length; i++) {
    const line = lines[i];
    const m = PAGE_RE.exec(line);
    if (m) {
      const p = parseInt(m[2],10); if (!isNaN(p)) page = p;
    }
    out.push({ i:i+1, page, line:i+1, start:offset, end:offset+line.length, text:line });
    offset += line.length + 1;
  }
  return out;
}

/* Aplica <mark> por severidad */
function highlightBySeverity(text="", matches=[]) {
  if (!text) return { __html: "" };
  let html = escapeHtml(text);
  const ms = [...matches].sort((a,b)=> (b.token?.length||0)-(a.token?.length||0));
  ms.forEach(m => {
    const token = (m.token||"").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (!token) return;
    const col = SEV_COL[m.severity] || SEV_COL.LOW;
    const re = new RegExp(`(${token})`, "gi");
    html = html.replace(
      re,
      `<mark style="background:${col.bg};color:${col.fg};border-radius:4px;padding:0 2px">$1</mark>`
    );
  });
  return { __html: html };
}

export default function ConvenioRiesgo(){
  const { id } = useParams();

  const [conv, setConv] = useState(null);
  const [versiones, setVersiones] = useState([]);
  const [sel, setSel] = useState("");
  const [texto, setTexto] = useState("");
  const [idx, setIdx] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [res, setRes] = useState(null);

  const [q, setQ] = useState("");
  const [onlyMatches, setOnlyMatches] = useState(false);

  const load = useCallback(async ()=>{
    const [a,b] = await Promise.all([
      api.get(`/convenios/${id}`),
      api.get(`/convenios/${id}/versiones`),
    ]);
    setConv(a.data);
    const vs = b.data || [];
    setVersiones(vs);
    if (vs.length) setSel(String(vs[0].id));
  }, [id]);

  useEffect(()=>{ load(); }, [load]);

  const loadText = useCallback(async (vid)=>{
    setErr(""); setTexto(""); setRes(null); setIdx([]);
    if (!vid) return;
    try {
      setLoading(true);
      const { data } = await api.get(`/versiones/${vid}/texto`);
      const t = norm(data?.text||"");
      setTexto(t);
      setIdx(indexText(t));
    } catch (e) {
      setErr(e.response?.data?.message || "No se pudo extraer el texto de la versión.");
    } finally { setLoading(false); }
  }, []);

  useEffect(()=>{ if (sel) loadText(sel); }, [sel, loadText]);

  const analizar = async ()=>{
    setErr(""); setRes(null);
    if (!texto.trim()) { setErr("No hay texto para analizar"); return; }
    try {
      setLoading(true);
      // Este endpoint debe ser tu puente Laravel => FastAPI /analyze
      const { data } = await api.post("/analisis/riesgo", { text: texto });
      const matches = data?.matches || [];
      const fixed = {
        ...data,
        risk_level: matches.length === 0 ? "BAJO" : (data?.risk_level || "BAJO"),
        score: matches.length === 0 ? 0 : (Number(data?.score) || 0),
      };
      setRes(fixed);
    } catch (e) {
      setErr(e.response?.data?.message || "No se pudo analizar el texto.");
    } finally { setLoading(false); }
  };

  // matches con page/line (si backend no los trae los inferimos)
  const matches = useMemo(()=>{
    const raw = res?.matches || [];
    if (!raw.length) return [];
    return raw.map(m=>{
      if (m.page && m.line) return m;
      if (typeof m.start === "number") {
        const L = idx.find(x => x.start <= m.start && m.start <= x.end);
        return { ...m, page: L?.page, line: L?.line };
      }
      return m;
    });
  }, [res, idx]);

  const level = (res?.risk_level && RISK[res.risk_level]) ? res.risk_level : "BAJO";
  const lvl = RISK[level];
  const score = Math.max(0, Math.min(1, Number(res?.score || 0)));
  const bySeverity = useMemo(()=>{
    const m = { HIGH:0, MEDIUM:0, LOW:0 };
    matches.forEach(x => m[x.severity] = (m[x.severity]||0) + 1);
    return m;
  }, [matches]);

  const tableRows = useMemo(()=>{
    const set = new Set();
    matches.forEach(m => set.add(m.line));
    return idx.filter(row => !onlyMatches || set.has(row.line));
  }, [idx, matches, onlyMatches]);

  const legend = (
    <div style={{display:"flex", gap:8, flexWrap:"wrap"}}>
      <span style={{background:SEV_COL.HIGH.bg, color:SEV_COL.HIGH.fg, borderRadius:8, padding:"2px 8px"}}>crítico (ALTO)</span>
      <span style={{background:SEV_COL.MEDIUM.bg, color:SEV_COL.MEDIUM.fg, borderRadius:8, padding:"2px 8px"}}>alto (MEDIO)</span>
      <span style={{background:SEV_COL.LOW.bg, color:SEV_COL.LOW.fg, borderRadius:8, padding:"2px 8px"}}>bajo (BAJO)</span>
    </div>
  );

  return (
    <div className="card" style={{padding:20}}>
      <div style={{display:"flex", gap:10, alignItems:"center", flexWrap:"wrap"}}>
        <Link to={`/convenios/${id}`} className="btn" style={BTN.back}>Volver al convenio</Link>
        <h2 style={{margin:0}}>Análisis de riesgo — {conv?.titulo || "…"}</h2>
      </div>

      <div className="card" style={{display:"flex", gap:10, alignItems:"center", flexWrap:"wrap"}}>
        <label>Versión:</label>
        <select value={sel} onChange={e=>setSel(e.target.value)}>
          {versiones.map(v => <option key={v.id} value={v.id}>v{v.numero_version}</option>)}
        </select>
        <button className="btn" style={{...BTN.primary, ...(loading?BTN.disabled:{})}} disabled={loading} onClick={analizar}>
          {loading ? "Analizando…" : "Analizar"}
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

      {/* HERO */}
      <div className="card" style={{marginTop:10, borderColor:lvl.bg, background:"rgba(0,0,0,.25)"}}>
        <div style={{display:"grid", gridTemplateColumns:"auto 1fr auto", gap:12, alignItems:"center"}}>
          <div style={{padding:"8px 14px", borderRadius:10, background:lvl.bg, color:lvl.fg, fontWeight:800, fontSize:18, minWidth:92, textAlign:"center"}}>
            {lvl.title}
          </div>
          <div>
            <div style={{fontSize:15, fontWeight:700}}>Clasificación de riesgo</div>
            <div style={{opacity:.9}}>{lvl.msg}</div>
          </div>
          <div style={{textAlign:"right"}}>
            <div style={{fontSize:12, opacity:.8}}>Score (0–1)</div>
            <div style={{fontWeight:800, fontSize:18}}>{score.toFixed(2)}</div>
          </div>
        </div>

        <div style={{display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:10, marginTop:12}}>
          <KPI label="Coincidencias" value={(res?.summary?.total)||matches.length} />
          <KPI label="Críticas/Altas/Bajas" value={`${bySeverity.HIGH}/${bySeverity.MEDIUM}/${bySeverity.LOW}`} />
          <KPI label="Tokens únicos" value={[...new Set(matches.map(m=> (m.token||"").toLowerCase()))].length} />
          <KPI label="Severidad usada" value={Object.entries(SEV_COL).length} />
        </div>

        <div style={{marginTop:10, height:8, background:"#111827", borderRadius:999}}>
          <div style={{width:`${score*100}%`, height:"100%", background:lvl.bg, borderRadius:999}}/>
        </div>
      </div>

      {/* LEYENDA + PASTILLAS */}
      <div className="card" style={{marginTop:10}}>
        <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", gap:10, flexWrap:"wrap"}}>
          <div style={{fontWeight:700}}>Leyenda de criticidad</div>
          {legend}
        </div>

        {matches.length === 0 ? (
          <div style={{opacity:.8, marginTop:8}}>No se detectaron palabras o cláusulas relevantes.</div>
        ) : (
          <div style={{display:"flex", gap:8, flexWrap:"wrap", marginTop:8}}>
            {matches.slice(0, 30).map((m,i)=>(
              <span key={i} style={{
                background:(SEV_COL[m.severity]||SEV_COL.LOW).bg,
                color:(SEV_COL[m.severity]||SEV_COL.LOW).fg,
                borderRadius:8, padding:"2px 8px"
              }}>
                {m.token} <span style={{opacity:.8}}>· {m.severity} · p{m.page ?? "?"} l{m.line ?? "?"}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* TEXTO tipo "comparador": Página / Línea / Texto con highlight por severidad */}
      <div className="card" style={{marginTop:10}}>
        <div style={{display:"flex", alignItems:"center", justifyContent:"space-between"}}>
          <h3 style={{margin:0, fontSize:16}}>Texto analizado</h3>
          <span style={{opacity:.8}}>{tableRows.length} líneas</span>
        </div>
        <div style={{maxHeight:480, overflow:"auto", marginTop:8}}>
          <table className="table" style={{
            minWidth: 820, borderCollapse:"collapse",
            fontFamily:"ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", fontSize:13
          }}>
            <thead style={{position:"sticky", top:0}}>
              <tr>
                <th style={{width:70, textAlign:"right"}}>Pág</th>
                <th style={{width:70, textAlign:"right"}}>Línea</th>
                <th>Texto</th>
              </tr>
            </thead>
            <tbody>
              {tableRows.map((r,i)=>{
                const mm = matches.filter(m => m.line === r.line);
                let html = escapeHtml(r.text||"");
                if (q) {
                  const safe = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                  html = html.replace(new RegExp(`(${safe})`,"gi"),
                    `<mark style="background:#60a5fa;color:#111827;border-radius:4px;padding:0 2px">$1</mark>`);
                }
                if (mm.length) {
                  html = highlightBySeverity(r.text, mm).__html;
                }
                return (
                  <tr key={i} style={{borderTop:"1px solid rgba(255,255,255,.08)"}}>
                    <td align="right">{r.page}</td>
                    <td align="right">{r.line}</td>
                    <td dangerouslySetInnerHTML={{__html: html}}/>
                  </tr>
                );
              })}
              {tableRows.length===0 && (
                <tr><td colSpan={3} style={{padding:12, opacity:.8}}>Sin líneas que mostrar.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function KPI({ label, value }) {
  return (
    <div style={{border:"1px solid rgba(255,255,255,.08)", borderRadius:10, padding:"10px 12px", background:"rgba(0,0,0,.2)"}}>
      <div style={{fontSize:12, opacity:.8}}>{label}</div>
      <div style={{fontWeight:800, fontSize:18, marginTop:2}}>{value}</div>
    </div>
  );
}