import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import DiffMatchPatch from "diff-match-patch";
import api from "../api";

/* ===== helpers ===== */
const escapeHtml = (s = "") =>
  s.replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));

const pageFromLine = (line) => {
  const m = /(p[áa]gina|page)\s+(\d+)/i.exec(line || "");
  return m ? parseInt(m[2], 10) : null;
};

/** Diff a NIVEL DE LÍNEA */
function buildLineDiff(aText = "", bText = "") {
  const dmp = new DiffMatchPatch();
  const diffs = dmp.diff_main(aText, bText);
  dmp.diff_cleanupSemantic(diffs);

  const rows = [];
  let la = 1, lb = 1;
  let pa = null, pb = null;

  const push = (op, line) => {
    const pA = (op <= 0) ? pageFromLine(line) : null;
    const pB = (op >= 0) ? pageFromLine(line) : null;
    if (pA != null) pa = pA;
    if (pB != null) pb = pB;

    if (op === 0) { rows.push({ op, aNum: la, bNum: lb, aPage: pa, bPage: pb, text: line }); la++; lb++; }
    else if (op === -1) { rows.push({ op, aNum: la, bNum: "", aPage: pa, bPage: "", text: line }); la++; }
    else { rows.push({ op, aNum: "", bNum: lb, aPage: "", bPage: pb, text: line }); lb++; }
  };

  for (const [op, data] of diffs) {
    const parts = (data ?? "").toString().split("\n");
    for (let i = 0; i < parts.length; i++) push(op, parts[i]);
  }
  return rows;
}

/* ===== estilos locales de botones ===== */
const BTN = {
  back:   { background:"#374151", borderColor:"#4b5563", color:"#e5e7eb" },
  action: { background:"#1a6779", borderColor:"#125463", color:"#fff" },
  dark:   { background:"#111827", borderColor:"#1f2937", color:"#e5e7eb" },
  disabled: { opacity:.7, cursor:"not-allowed" },
};

export default function ConvenioComparar() {
  const { id } = useParams();

  const [conv, setConv] = useState(null);
  const [versiones, setVersiones] = useState([]);
  const [selA, setSelA] = useState("");
  const [selB, setSelB] = useState("");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  // búsqueda
  const [q, setQ] = useState("");
  const matches = useMemo(() => {
    if (!q) return [];
    const idxs = [];
    rows.forEach((r, i) => {
      if (r.text && r.text.toLowerCase().includes(q.toLowerCase())) idxs.push(i);
    });
    return idxs;
  }, [q, rows]);
  const [cur, setCur] = useState(0);
  const containerRef = useRef(null);

  const load = useCallback(async () => {
    const [a, b] = await Promise.all([
      api.get(`/convenios/${id}`),
      api.get(`/convenios/${id}/versiones`),
    ]);
    setConv(a.data);
    const vs = b.data || [];
    setVersiones(vs);
    if (vs.length >= 2) {
      const last = vs[0], prev = vs[1];
      setSelA(String(prev.id));
      setSelB(String(last.id));
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const comparar = async (e) => {
    e?.preventDefault();
    if (!selA || !selB || selA === selB) {
      alert("Selecciona dos versiones distintas"); return;
    }
    try {
      setLoading(true);
      const [ta, tb] = await Promise.all([
        api.get(`/versiones/${selA}/texto`),
        api.get(`/versiones/${selB}/texto`),
      ]);
      const textA = ta.data?.text ?? "";
      const textB = tb.data?.text ?? "";
      const rs = buildLineDiff(textA, textB);
      setRows(rs);
      setCur(0);
      setTimeout(() => {
        if (matches.length > 0 && containerRef.current) {
          const el = containerRef.current.querySelector(`[data-row="${matches[0]}"]`);
          el?.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }, 0);
    } catch (err) {
      alert(err.response?.data?.message || "No se pudo comparar (¿archivo soportado?)");
      setRows([]);
    } finally { setLoading(false); }
  };

  useEffect(() => { setCur(0); }, [q]);

  const gotoMatch = (dir) => {
    if (!matches.length) return;
    const next = (cur + (dir === "next" ? 1 : -1) + matches.length) % matches.length;
    setCur(next);
    const idx = matches[next];
    const el = containerRef.current?.querySelector(`[data-row="${idx}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <div className="card" style={{ padding:20 }}>
      {/* Header */}
      <div style={{display:"flex", alignItems:"center", gap:8, flexWrap:"wrap", marginBottom:6}}>
        <Link to={`/convenios/${id}`} className="btn" style={BTN.back}>Volver al convenio</Link>
        <h2 style={{margin:0}}>Comparar versiones — {conv?.titulo || "..."}</h2>
      </div>

      {/* Controles */}
      <div className="card" style={{marginTop:10}}>
        <form onSubmit={comparar}
              style={{display:"flex", gap:8, alignItems:"center", flexWrap:"wrap"}}>
          <select value={selA} onChange={(e)=>setSelA(e.target.value)}>
            <option value="">Versión A…</option>
            {versiones.map(v => <option key={v.id} value={v.id}>v{v.numero_version}</option>)}
          </select>
          <span>vs</span>
          <select value={selB} onChange={(e)=>setSelB(e.target.value)}>
            <option value="">Versión B…</option>
            {versiones.map(v => <option key={v.id} value={v.id}>v{v.numero_version}</option>)}
          </select>

          <button
            className="btn"
            style={{...BTN.action, ...( (!selA || !selB || selA===selB || loading) ? BTN.disabled : {} )}}
            disabled={!selA || !selB || selA===selB || loading}
          >
            Comparar
          </button>

          <div style={{marginLeft:"auto", display:"flex", gap:8, alignItems:"center"}}>
            <input
              placeholder="Buscar en resultado…"
              value={q}
              onChange={(e)=>setQ(e.target.value)}
              style={{minWidth:220}}
            />
            <button type="button" className="btn"
                    style={{...BTN.dark, ...( !matches.length ? BTN.disabled : {} )}}
                    disabled={!matches.length}
                    onClick={()=>gotoMatch("prev")}>◀</button>
            <button type="button" className="btn"
                    style={{...BTN.dark, ...( !matches.length ? BTN.disabled : {} )}}
                    disabled={!matches.length}
                    onClick={()=>gotoMatch("next")}>▶</button>
            <span style={{fontSize:12, opacity:.8}}>
              {matches.length ? `${cur+1}/${matches.length}` : "0 resultados"}
            </span>
          </div>
        </form>

        {/* Leyenda */}
        <div style={{marginTop:10, display:"flex", gap:10, fontSize:12}}>
          <span style={{background:"#7f1d1d", color:"#fff", padding:"2px 8px", borderRadius:6}}>eliminado (A)</span>
          <span style={{background:"#14532d", color:"#fff", padding:"2px 8px", borderRadius:6}}>agregado (B)</span>
        </div>
      </div>

      {/* Resultado */}
      <div className="card" style={{marginTop:10}}>
        <div ref={containerRef} style={{maxHeight:480, overflow:"auto"}}>
          <table className="table" style={{
            minWidth: 820,
            borderCollapse:"collapse",
            fontFamily:"ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
            fontSize:13
          }}>
            <thead style={{position:"sticky", top:0}}>
              <tr>
                <th style={{width:70, textAlign:"right"}}>Pág A</th>
                <th style={{width:70, textAlign:"right"}}>Línea A</th>
                <th>Texto</th>
                <th style={{width:70, textAlign:"right"}}>Pág B</th>
                <th style={{width:70, textAlign:"right"}}>Línea B</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const isAdd = r.op === 1;
                const isDel = r.op === -1;
                let text = escapeHtml(r.text || "");
                if (q) {
                  const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")})`, "gi");
                  text = text.replace(
                    re,
                    '<mark style="background:#f59e0b;color:#111827;border-radius:3px;padding:0 2px">$1</mark>'
                  );
                }
                return (
                  <tr key={i} data-row={i}
                      style={{
                        background: isAdd ? "#14532d" : isDel ? "#7f1d1d" : "transparent",
                        color: (isAdd || isDel) ? "#fff" : "inherit",
                        borderTop: "1px solid rgba(255,255,255,.08)"
                      }}>
                    <td align="right">{r.aPage || ""}</td>
                    <td align="right">{r.aNum || ""}</td>
                    <td dangerouslySetInnerHTML={{__html: text}} />
                    <td align="right">{r.bPage || ""}</td>
                    <td align="right">{r.bNum || ""}</td>
                  </tr>
                );
              })}
              {!rows.length && (
                <tr>
                  <td colSpan={5} style={{padding:12, opacity:.8}}>
                    Sin resultado. Elige dos versiones y presiona “Comparar”.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}