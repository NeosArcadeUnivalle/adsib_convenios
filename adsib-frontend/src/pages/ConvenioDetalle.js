import { useCallback, useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import api from "../api";

/* --------- helpers --------- */
const filenameFromDisposition = (dispo = "") => {
  const m = /filename\*=UTF-8''([^;]+)|filename="?([^"]+)"?/i.exec(dispo);
  return m ? decodeURIComponent(m[1] || m[2]) : "archivo";
};
const fmtDate = (v) => {
  if (!v) return "—";
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "2-digit", day: "2-digit" });
};

/* --------- estilos locales de botones (no toca AppShell.css) --------- */
const BTN = {
  back:     { background:"#374151", borderColor:"#4b5563", color:"#e5e7eb" },
  info:     { background:"#0ea5e9", borderColor:"#0284c7", color:"#fff" },      // Análisis de riesgo
  action:   { background:"#1a6779", borderColor:"#125463", color:"#fff" },      // Abrir comparador
  warn:     { background:"#eab308", borderColor:"#a16207", color:"#1f2937" },
  danger:   { background:"#dc2626", borderColor:"#b91c1c", color:"#fff" },
  dark:     { background:"#111827", borderColor:"#1f2937", color:"#e5e7eb" },
  disabled: { opacity:.7, cursor:"not-allowed" },
};

export default function ConvenioDetalle() {
  const { id } = useParams();
  const nav = useNavigate();

  const [c, setC] = useState(null);
  const [archivo, setArchivo] = useState(null);
  const [vFile, setVFile] = useState(null);
  const [observ, setObserv] = useState("");
  const [versiones, setVersiones] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    const [a, b] = await Promise.all([
      api.get(`/convenios/${id}`),
      api.get(`/convenios/${id}/versiones`),
    ]);
    setC(a.data);
    setVersiones(b.data || []);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  /* ====== Archivo base del convenio ====== */
  const subir = async (e) => {
    e.preventDefault();
    if (!archivo) return;
    const fd = new FormData();
    fd.append("archivo", archivo);
    try {
      setLoading(true);
      await api.post(`/convenios/${id}/archivo`, fd);
      setArchivo(null);
      await load();
    } catch (err) {
      alert(err.response?.data?.message || "Error al subir archivo");
    } finally { setLoading(false); }
  };

  const eliminarBase = async () => {
    if (!window.confirm("¿Eliminar el archivo base del convenio?")) return;
    try {
      setLoading(true);
      await api.delete(`/convenios/${id}/archivo`);
      await load();
    } catch (err) {
      alert(err.response?.data?.message || "Error al eliminar archivo");
    } finally { setLoading(false); }
  };

  const descargarBase = async () => {
    try {
      const res = await api.get(`/convenios/${id}/archivo/descargar`, { responseType: "blob" });
      const name = filenameFromDisposition(res.headers["content-disposition"]);
      const url = URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement("a");
      a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(err.response?.data?.message || "No se pudo descargar.");
    }
  };

  /* ====== Versiones ====== */
  const crearVersion = async (e) => {
    e.preventDefault();
    if (!vFile) return;
    const fd = new FormData();
    fd.append("archivo", vFile);
    if (observ) fd.append("observaciones", observ);
    try {
      setLoading(true);
      await api.post(`/convenios/${id}/versiones`, fd);
      setVFile(null); setObserv("");
      await load();
    } catch (err) {
      alert(err.response?.data?.message || "Error al crear versión");
    } finally { setLoading(false); }
  };

  const descargarV = async (vid) => {
    try {
      const res = await api.get(`/versiones/${vid}/descargar`, { responseType: "blob" });
      const name = filenameFromDisposition(res.headers["content-disposition"]);
      const url = URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement("a");
      a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(err.response?.data?.message || "No se pudo descargar.");
    }
  };

  const eliminarV = async (vid) => {
    if (!window.confirm("¿Eliminar esta versión?")) return;
    try {
      await api.delete(`/versiones/${vid}`);
      await load();
    } catch (err) {
      alert(err.response?.data?.message || "No se pudo eliminar la versión.");
    }
  };

  return (
    <div className="card" style={{ padding:20 }}>
      {/* Header con botón Volver, título y acciones */}
      <div style={{display:"grid", gridTemplateColumns:"1fr auto", alignItems:"center", gap:10}}>
        {/* Izquierda: volver + título */}
        <div style={{display:"flex", gap:8, alignItems:"center"}}>
          <Link to="/" className="btn" style={BTN.back}>Volver</Link>
          <h2 style={{margin:0}}>{c?.titulo || "..."}</h2>
        </div>
        {/* Derecha: acciones alineadas */}
        <div style={{display:"flex", gap:8}}>
          <button
            onClick={()=>nav(`/convenios/${id}/riesgo`)}
            className="btn"
            style={BTN.action}
          >
            Análisis de riesgo
          </button>
          <button
            className="btn"
            style={BTN.action}
            onClick={()=>nav(`/convenios/${id}/comparar`)}
          >
            Comparador
          </button>
        </div>
      </div>

      {/* Meta del convenio */}
      <div className="card" style={{marginTop:14}}>
        <div style={{display:"grid", gap:10, gridTemplateColumns:"repeat(12,1fr)"}}>
          <div style={{gridColumn:"1 / span 12"}}>
            <strong>Descripción:</strong> {c?.descripcion || "—"}
          </div>
          <div style={{gridColumn:"1 / span 4", minWidth:220}}>
            <strong>Estado:</strong> {c?.estado || "—"}
          </div>
          <div style={{gridColumn:"5 / span 4", minWidth:220}}>
            <strong>Fecha de firma:</strong> {fmtDate(c?.fecha_firma)}
          </div>
          <div style={{gridColumn:"9 / span 4", minWidth:220}}>
            <strong>Fecha de vencimiento:</strong> {fmtDate(c?.fecha_vencimiento)}
          </div>
        </div>
      </div>

      {/* Archivo base */}
      <div className="card" style={{marginTop:14}}>
        <h3 style={{marginTop:0}}>Archivo del convenio</h3>

        {c?.archivo_nombre_original ? (
          <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
            <span style={{fontWeight:600}}>{c.archivo_nombre_original}</span>
            <button className="btn" style={BTN.info} onClick={descargarBase}>Descargar</button>
            <button className="btn" style={BTN.danger} onClick={eliminarBase} disabled={loading}>
              Eliminar
            </button>
          </div>
        ) : (
          <div>Sin archivo base.</div>
        )}

        <form onSubmit={subir} style={{ marginTop:12, display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
          <input type="file" accept=".pdf,.docx" onChange={(e)=>setArchivo(e.target.files?.[0]||null)} />
          <button
            type="submit"
            className="btn"
            style={{...BTN.dark, ...( !archivo || loading ? BTN.disabled : {})}}
            disabled={!archivo || loading}
          >
            {c?.archivo_nombre_original ? "Reemplazar archivo" : "Subir archivo"}
          </button>
        </form>
      </div>

      {/* Versiones */}
      <div className="card" style={{marginTop:14}}>
        <h3 style={{marginTop:0}}>Versiones</h3>

        <form onSubmit={crearVersion} style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap", marginBottom:10 }}>
          <input type="file" accept=".pdf,.docx" onChange={(e)=>setVFile(e.target.files?.[0]||null)} />
          <input
            placeholder="Observaciones"
            value={observ}
            onChange={(e)=>setObserv(e.target.value)}
            style={{minWidth:240}}
          />
          <button
            type="submit"
            className="btn"
            style={{...BTN.info, ...( !vFile || loading ? BTN.disabled : {})}}
            disabled={!vFile || loading}
          >
            Nueva versión
          </button>
        </form>

        <div style={{overflowX:"auto"}}>
          <table className="table" style={{minWidth: 760}}>
            <thead>
              <tr>
                <th style={{width:60}}>v</th>
                <th align="left">Archivo</th>
                <th style={{width:140}}>Fecha</th>
                <th>Observaciones</th>
                <th style={{width:190}}></th>
              </tr>
            </thead>
            <tbody>
              {versiones.map(v=>(
                <tr key={v.id}>
                  <td align="center">v{v.numero_version}</td>
                  <td>{v.archivo_nombre_original}</td>
                  <td align="center">{fmtDate(v.fecha_version)}</td>
                  <td>{v.observaciones || "—"}</td>
                  <td align="right" style={{whiteSpace:"nowrap"}}>
                    <button className="btn" style={BTN.info} onClick={()=>descargarV(v.id)}>Descargar</button>{" "}
                    <button className="btn" style={BTN.danger} onClick={()=>eliminarV(v.id)} disabled={loading}>Eliminar</button>
                  </td>
                </tr>
              ))}
              {versiones.length === 0 && (
                <tr><td colSpan={5} align="center" style={{padding:12, opacity:.7}}>Sin versiones todavía.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}