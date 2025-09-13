import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import DiffMatchPatch from "diff-match-patch";
import api from "../api";

/* ===== helpers ===== */
const escapeHtml = (s = "") =>
  s.replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));

// Detecta "Página 1", "PÁGINA 2", "Page 3"
const pageFromLine = (line) => {
  const m = /(p[áa]gina|page)\s+(\d+)/i.exec(line || "");
  return m ? parseInt(m[2], 10) : null;
};

/**
 * Construye un diff a NIVEL DE LÍNEA sin usar métodos privados de DMP.
 * Se apoya en diff_main (caracteres) y luego parte cada bloque por "\n",
 * llevando contadores de línea A/B y heurística de página.
 */
function buildLineDiff(aText = "", bText = "") {
  const dmp = new DiffMatchPatch();
  const diffs = dmp.diff_main(aText, bText);
  dmp.diff_cleanupSemantic(diffs);

  const rows = [];
  let la = 1, lb = 1;     // contadores de línea
  let pa = null, pb = null; // páginas "actuales" heurísticas

  const push = (op, line) => {
    // heurística de página (si la línea contiene "Página N", recuerda)
    const pA = (op <= 0) ? pageFromLine(line) : null;
    const pB = (op >= 0) ? pageFromLine(line) : null;
    if (pA != null) pa = pA;
    if (pB != null) pb = pB;

    if (op === 0) {
      rows.push({ op, aNum: la, bNum: lb, aPage: pa, bPage: pb, text: line });
      la++; lb++;
    } else if (op === -1) {
      rows.push({ op, aNum: la, bNum: "", aPage: pa, bPage: "", text: line });
      la++;
    } else { // +1
      rows.push({ op, aNum: "", bNum: lb, aPage: "", bPage: pb, text: line });
      lb++;
    }
  };

  // Recorremos cada bloque del diff y lo dividimos en líneas
  for (const [op, data] of diffs) {
    // Aseguramos string
    const txt = (data ?? "").toString();
    // Partir SIEMPRE (conservamos líneas vacías)
    const parts = txt.split("\n");
    for (let i = 0; i < parts.length; i++) {
      push(op, parts[i]);
    }
  }
  return rows;
}

export default function ConvenioComparar() {
  const { id } = useParams();

  const [conv, setConv] = useState(null);
  const [versiones, setVersiones] = useState([]);
  const [selA, setSelA] = useState("");
  const [selB, setSelB] = useState("");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  // búsqueda en resultado
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
    // Selección por defecto: las dos últimas (suponiendo backend las entrega desc)
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
      // Si el backend devolvió texto vacío, evitamos excepción
      const textA = ta.data?.text ?? "";
      const textB = tb.data?.text ?? "";

      const rs = buildLineDiff(textA, textB);
      setRows(rs);
      setCur(0);

      // Scroll al primer match
      setTimeout(() => {
        if (matches.length > 0 && containerRef.current) {
          const el = containerRef.current.querySelector(`[data-row="${matches[0]}"]`);
          el?.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }, 0);
    } catch (err) {
      console.error("Comparación falló:", err);
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
    <div style={{ padding: 16 }}>
      <Link to={`/convenios/${id}`}>← Volver al convenio</Link>
      <h2 style={{ marginTop: 8 }}>Comparar versiones – {conv?.titulo || "..."}</h2>

      {/* Selección de versiones */}
      <form onSubmit={comparar} style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",marginBottom:8}}>
        <select value={selA} onChange={(e)=>setSelA(e.target.value)}>
          <option value="">Versión A…</option>
          {versiones.map(v => <option key={v.id} value={v.id}>v{v.numero_version}</option>)}
        </select>
        <span>vs</span>
        <select value={selB} onChange={(e)=>setSelB(e.target.value)}>
          <option value="">Versión B…</option>
          {versiones.map(v => <option key={v.id} value={v.id}>v{v.numero_version}</option>)}
        </select>
        <button disabled={!selA || !selB || loading}>Comparar</button>

        <div style={{marginLeft:12, display:"flex", gap:8, alignItems:"center"}}>
          <input
            placeholder="Buscar en resultado…"
            value={q}
            onChange={(e)=>setQ(e.target.value)}
          />
          <button type="button" disabled={!matches.length} onClick={()=>gotoMatch("prev")}>◀</button>
          <button type="button" disabled={!matches.length} onClick={()=>gotoMatch("next")}>▶</button>
          <span style={{fontSize:12,color:"#555"}}>
            {matches.length ? `${cur+1}/${matches.length}` : "0 resultados"}
          </span>
        </div>
      </form>

      {/* Leyenda */}
      <div style={{marginBottom:6, fontSize:12, color:"#666"}}>
        <span style={{background:"#fee2e2"}}> eliminado (A) </span> /
        <span style={{background:"#dcfce7"}}> agregado (B) </span>
      </div>

      {/* Tabla de diferencias */}
      <div ref={containerRef} style={{border:"1px solid #e5e7eb", borderRadius:8, maxHeight:480, overflow:"auto"}}>
        <table width="100%" cellPadding={4} style={{borderCollapse:"collapse", fontFamily:"ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", fontSize:13}}>
          <thead style={{position:"sticky", top:0, background:"#fafafa"}}>
            <tr>
              <th style={{width:70, textAlign:"right"}}>Pág A</th>
              <th style={{width:70, textAlign:"right"}}>Línea A</th>
              <th></th>
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
                text = text.replace(re, "<mark>$1</mark>");
              }
              return (
                <tr key={i} data-row={i}
                  style={{
                    background: isAdd ? "#dcfce7" : isDel ? "#fee2e2" : "transparent",
                    borderTop: "1px solid #f3f4f6"
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
              <tr><td colSpan={5} style={{padding:12,color:"#777"}}>Sin resultado. Elige dos versiones y presiona “Comparar”.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}