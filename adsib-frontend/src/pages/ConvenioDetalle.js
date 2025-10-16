// src/pages/ConvenioDetalle.js
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import api from "../api";

/* --------- helpers --------- */
const PER_PAGE = 5;

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

/* --------- estilos locales --------- */
const BTN = {
  back:     { background:"#374151", borderColor:"#4b5563", color:"#e5e7eb" },
  info:     { background:"#0ea5e9", borderColor:"#0284c7", color:"#fff" },
  action:   { background:"#1a6779", borderColor:"#125463", color:"#fff" },
  warn:     { background:"#eab308", borderColor:"#a16207", color:"#1f2937" },
  danger:   { background:"#dc2626", borderColor:"#b91c1c", color:"#fff" },
  dark:     { background:"#111827", borderColor:"#1f2937", color:"#e5e7eb" },
  disabled: { opacity:.7, cursor:"not-allowed" },
};

export default function ConvenioDetalle() {
  const { id } = useParams();
  const nav = useNavigate();

  const [c, setC] = useState(null);

  // lista/paginación
  const [versiones, setVersiones] = useState([]);
  const [page, setPage] = useState(1);
  const [meta, setMeta] = useState({ current_page: 1, last_page: 1, total: 0 });
  const [loadingList, setLoadingList] = useState(false);

  // subir base
  const [archivo, setArchivo] = useState(null);
  const [loadingBase, setLoadingBase] = useState(false);

  // nueva versión
  const [vFile, setVFile] = useState(null);
  const [observ, setObserv] = useState("");
  const [finalizar, setFinalizar] = useState(false); // NUEVO: marcar versión final (cierra convenio)
  const [uploading, setUploading] = useState(false);
  const vInputRef = useRef(null);

  const normalizeIndexPayload = (resData) => {
    // Soporta backend paginado {data, meta} o antiguo [array]
    if (Array.isArray(resData)) {
      return {
        data: resData.slice(0, PER_PAGE),
        meta: { current_page: 1, last_page: 1, total: resData.length }
      };
    }
    // Laravel paginator standard
    if (resData?.data && resData?.meta) {
      return { data: resData.data, meta: resData.meta };
    }
    // Laravel simplePaginate
    if (resData?.data && resData?.current_page) {
      const { data, current_page, last_page, total } = resData;
      return { data, meta: { current_page, last_page, total } };
    }
    // Fallback
    return { data: [], meta: { current_page: 1, last_page: 1, total: 0 } };
  };

  const loadConvenio = useCallback(async () => {
    const { data } = await api.get(`/convenios/${id}`);
    setC(data);
  }, [id]);

  const loadPage = useCallback(async (p = 1) => {
    try {
      setLoadingList(true);
      const { data } = await api.get(`/convenios/${id}/versiones`, {
        params: { page: p, per_page: PER_PAGE }
      });
      const { data: rows, meta } = normalizeIndexPayload(data);
      setVersiones(rows || []);
      setMeta({
        current_page: Number(meta.current_page || p),
        last_page: Number(meta.last_page || 1),
        total: Number(meta.total || (rows?.length ?? 0))
      });
      setPage(Number(meta.current_page || p));
    } catch (err) {
      alert(err.response?.data?.message || "No se pudo cargar versiones");
    } finally {
      setLoadingList(false);
    }
  }, [id]);

  useEffect(() => {
    loadConvenio();
    loadPage(1);
  }, [loadConvenio, loadPage]);

  /* ====== Archivo base del convenio ====== */
  const subir = async (e) => {
    e.preventDefault();
    if (!archivo) return;
    const fd = new FormData();
    fd.append("archivo", archivo);
    try {
      setLoadingBase(true);
      await api.post(`/convenios/${id}/archivo`, fd);
      setArchivo(null);
      await loadConvenio();
      // Si tu backend genera versión base aparte, descomenta:
      // await loadPage(1);
    } catch (err) {
      alert(err.response?.data?.message || "Error al subir archivo");
    } finally {
      setLoadingBase(false);
    }
  };

  const eliminarBase = async () => {
    if (!window.confirm("¿Eliminar el archivo base del convenio?")) return;
    try {
      setLoadingBase(true);
      await api.delete(`/convenios/${id}/archivo`);
      await loadConvenio();
    } catch (err) {
      alert(err.response?.data?.message || "Error al eliminar archivo");
    } finally {
      setLoadingBase(false);
    }
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
    if (observ)    fd.append("observaciones", observ);
    if (finalizar) fd.append("final", "1");

    try {
      setUploading(true);
      const { data } = await api.post(`/convenios/${id}/versiones`, fd);
      const nueva = data?.version || null;

      // limpiar input y campos
      setVFile(null);
      setObserv("");
      setFinalizar(false);
      if (vInputRef.current) vInputRef.current.value = "";

      // recargar cabecera (puede cambiar estado a CERRADO)
      await loadConvenio();

      // Si estoy en la página 1, inserto en vivo
      if (page === 1 && nueva) {
        setVersiones(prev => [nueva, ...prev].slice(0, PER_PAGE));
        setMeta(m => {
          const total = (m.total || 0) + 1;
          return {
            ...m,
            total,
            last_page: Math.max(1, Math.ceil(total / PER_PAGE)),
            current_page: 1
          };
        });
      } else {
        setPage(1);
        await loadPage(1);
      }
    } catch (err) {
      alert(err.response?.data?.message || "Error al crear versión");
    } finally {
      setUploading(false);
    }
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
      // Ajusta lista y meta localmente
      if (page === 1) {
        setVersiones(prev => prev.filter(x => x.id !== vid));
      }
      setMeta(m => {
        const total = Math.max(0, (m.total || 1) - 1);
        const last = Math.max(1, Math.ceil(total / PER_PAGE));
        // Si la página actual queda fuera de rango, retrocede
        const newPage = Math.min(page, last);
        if (newPage !== page) {
          setPage(newPage);
          loadPage(newPage);
        }
        return { ...m, total, last_page: last };
      });
      // refresco por si hay huecos
      await loadPage(page);
    } catch (err) {
      alert(err.response?.data?.message || "No se pudo eliminar la versión.");
    }
  };

  const goPrev = () => { if (page > 1) loadPage(page - 1); };
  const goNext = () => { if (page < (meta.last_page || 1)) loadPage(page + 1); };

  return (
    <div className="card" style={{ padding:20 }}>
      {/* Header */}
      <div style={{display:"grid", gridTemplateColumns:"1fr auto", alignItems:"center", gap:10}}>
        <div style={{display:"flex", gap:8, alignItems:"center"}}>
          <Link to="/" className="btn" style={BTN.back}>Volver</Link>
          <h2 style={{margin:0}}>{c?.titulo || "..."}</h2>
        </div>
        <div style={{display:"flex", gap:8}}>
          <button onClick={()=>nav(`/convenios/${id}/riesgo`)} className="btn" style={BTN.action}>
            Análisis de riesgo
          </button>
          <button className="btn" style={BTN.action} onClick={()=>nav(`/convenios/${id}/comparar`)}>
            Comparador
          </button>
        </div>
      </div>

      {/* Meta */}
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
            <button className="btn" style={BTN.danger} onClick={eliminarBase} disabled={loadingBase}>
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
            style={{...BTN.dark, ...( !archivo || loadingBase ? BTN.disabled : {})}}
            disabled={!archivo || loadingBase}
          >
            {c?.archivo_nombre_original ? "Reemplazar archivo" : "Subir archivo"}
          </button>
        </form>
      </div>

      {/* Versiones */}
      <div className="card" style={{marginTop:14}}>
        <h3 style={{marginTop:0}}>Versiones</h3>

        <form onSubmit={crearVersion} style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap", marginBottom:10 }}>
          <input ref={vInputRef} type="file" accept=".pdf,.docx" onChange={(e)=>setVFile(e.target.files?.[0]||null)} />
          <input
            placeholder="Observaciones"
            value={observ}
            onChange={(e)=>setObserv(e.target.value)}
            style={{minWidth:240}}
          />
          <label style={{display:"inline-flex", alignItems:"center", gap:6}}>
            <input type="checkbox" checked={finalizar} onChange={(e)=>setFinalizar(e.target.checked)} />
            Marcar como versión final (cerrar convenio)
          </label>
          <button
            type="submit"
            className="btn"
            style={{...BTN.info, ...( !vFile || uploading ? BTN.disabled : {})}}
            disabled={!vFile || uploading}
          >
            {uploading ? "Subiendo..." : "Nueva versión"}
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
              {loadingList ? (
                <tr><td colSpan={5} align="center" style={{padding:12, opacity:.7}}>Cargando…</td></tr>
              ) : versiones.length === 0 ? (
                <tr><td colSpan={5} align="center" style={{padding:12, opacity:.7}}>Sin versiones todavía.</td></tr>
              ) : (
                versiones.map(v=>(
                  <tr key={v.id}>
                    <td align="center">v{v.numero_version}</td>
                    <td>{v.archivo_nombre_original}</td>
                    <td align="center">{fmtDate(v.fecha_version)}</td>
                    <td>{v.observaciones || (v.numero_version === 1 ? "Archivo inicial" : "—")}</td>
                    <td align="right" style={{whiteSpace:"nowrap"}}>
                      <button className="btn" style={BTN.info} onClick={()=>descargarV(v.id)}>Descargar</button>{" "}
                      <button className="btn" style={BTN.danger} onClick={()=>eliminarV(v.id)} disabled={uploading || loadingList}>Eliminar</button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Paginación simple y siempre visible */}
        <div className="card" style={{display:"flex", justifyContent:"center", alignItems:"center", gap:12, marginTop:10}}>
          <button className="btn" style={{...BTN.dark, ...(page<=1 ? BTN.disabled : {})}} disabled={page<=1} onClick={goPrev}>
            Anterior
          </button>
          <span style={{opacity:.9}}>Página {meta.current_page || page} / {meta.last_page || 1}</span>
          <button className="btn" style={{...BTN.dark, ...(page>=(meta.last_page||1) ? BTN.disabled : {})}} disabled={page>=(meta.last_page||1)} onClick={goNext}>
            Siguiente
          </button>
        </div>
      </div>
    </div>
  );
}