import { useCallback, useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import api from "../api";

const filenameFromDisposition = (dispo = "") => {
  const m = /filename\*=UTF-8''([^;]+)|filename="?([^"]+)"?/i.exec(dispo);
  return m ? decodeURIComponent(m[1] || m[2]) : "archivo";
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

  const eliminar = async () => {
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
    <div style={{ padding: 16 }}>
      <Link to="/">← Volver</Link>

      <h2 style={{ marginTop: 8 }}>{c?.titulo || "..."}</h2>
      <div><b>Descripción:</b> {c?.descripcion || "—"}</div>
      <div><b>Estado:</b> {c?.estado || "—"}</div>
      <div><b>Fecha de firma:</b> {c?.fecha_firma || "—"}</div>
      <div><b>Fecha de vencimiento:</b> {c?.fecha_vencimiento || "—"}</div>

      <div style={{marginTop: 12}}>
        <button onClick={()=>nav(`/convenios/${id}/comparar`)}>Abrir comparador</button>
      </div>

      <h3 style={{ marginTop: 16 }}>Archivo del convenio</h3>
      {c?.archivo_nombre_original ? (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span>{c.archivo_nombre_original}</span>
          <button onClick={descargarBase}>Descargar</button>
          <button onClick={eliminar} disabled={loading}>Eliminar</button>
        </div>
      ) : <div>Sin archivo base.</div>}

      <form onSubmit={subir} style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center" }}>
        <input type="file" accept=".pdf,.docx" onChange={(e)=>setArchivo(e.target.files?.[0]||null)} />
        <button type="submit" disabled={!archivo || loading}>
          {c?.archivo_nombre_original ? "Reemplazar archivo" : "Subir archivo"}
        </button>
      </form>

      <h3 style={{ marginTop: 24 }}>Versiones</h3>
      <form onSubmit={crearVersion} style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
        <input type="file" accept=".pdf,.docx" onChange={(e)=>setVFile(e.target.files?.[0]||null)} />
        <input placeholder="Observaciones" value={observ} onChange={(e)=>setObserv(e.target.value)} />
        <button type="submit" disabled={!vFile || loading}>+ Nueva versión</button>
      </form>

      <table width="100%" cellPadding={6} style={{ marginTop: 10, borderCollapse: "collapse" }}>
        <thead><tr>
          <th>v</th><th align="left">Archivo</th><th>Fecha</th><th>Observaciones</th><th></th>
        </tr></thead>
        <tbody>
          {versiones.map(v=>(
            <tr key={v.id} style={{ borderTop: "1px solid #eee" }}>
              <td align="center">v{v.numero_version}</td>
              <td>{v.archivo_nombre_original}</td>
              <td align="center">{new Date(v.fecha_version).toLocaleString()}</td>
              <td>{v.observaciones || "—"}</td>
              <td align="right" style={{whiteSpace:"nowrap"}}>
                <button onClick={()=>descargarV(v.id)}>Descargar</button>{" "}
                <button onClick={()=>eliminarV(v.id)} disabled={loading}>Eliminar</button>
              </td>
            </tr>
          ))}
          {versiones.length === 0 && (
            <tr><td colSpan={5} align="center" style={{padding:12,color:"#666"}}>Sin versiones todavía.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}