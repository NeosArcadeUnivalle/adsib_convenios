import { useCallback, useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import api from "../api";

export default function ConvenioDetalle() {
  const { id } = useParams();
  const [c, setC] = useState(null);
  const [archivo, setArchivo] = useState(null);
  const [loading, setLoading] = useState(false);

  // Carga los datos del convenio (memoizado para evitar el warning)
  const load = useCallback(async () => {
    const { data } = await api.get(`/convenios/${id}`);
    setC(data);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // Subir o reemplazar archivo (PDF/DOCX)
  const subir = async (e) => {
    e.preventDefault();
    if (!archivo) return;

    const fd = new FormData();
    fd.append("archivo", archivo);

    try {
      setLoading(true);
      await api.post(`/convenios/${id}/archivo`, fd); // no fuerces headers
      setArchivo(null);
      await load();
    } catch (err) {
      console.error(err.response?.data || err.message);
      alert(err.response?.data?.message || "Error al subir archivo");
    } finally {
      setLoading(false);
    }
  };

  // Eliminar archivo actual
  const eliminar = async () => {
    try {
      setLoading(true);
      await api.delete(`/convenios/${id}/archivo`);
      await load();
    } catch (err) {
      console.error(err.response?.data || err.message);
      alert(err.response?.data?.message || "Error al eliminar archivo");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: 16 }}>
      <Link to="/">← Volver</Link>

      <h2 style={{ marginTop: 8 }}>{c?.titulo || "..."}</h2>
      <div><b>Descripción:</b> {c?.descripcion || "—"}</div>
      <div><b>Fecha de firma:</b> {c?.fecha_firma || "—"}</div>
      <div><b>Fecha de vencimiento:</b> {c?.fecha_vencimiento || "—"}</div>

      <h3 style={{ marginTop: 16 }}>Archivo</h3>
      {c?.archivo_nombre_original ? (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span>{c.archivo_nombre_original}</span>
          <a href={`/api/convenios/${id}/archivo/descargar`}>Descargar</a>
          <button onClick={eliminar} disabled={loading}>Eliminar</button>
        </div>
      ) : (
        <div>Sin archivo adjunto.</div>
      )}

      <form onSubmit={subir} style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center" }}>
        <input
          type="file"
          accept=".pdf,.docx"
          onChange={(e) => setArchivo(e.target.files?.[0] || null)}
        />
        <button type="submit" disabled={!archivo || loading}>
          {c?.archivo_nombre_original ? "Reemplazar archivo" : "Subir archivo"}
        </button>
      </form>
    </div>
  );
}