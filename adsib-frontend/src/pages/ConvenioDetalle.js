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

  // nueva versión
  const [vFile, setVFile] = useState(null);
  const [observ, setObserv] = useState("");
  const [finalizar, setFinalizar] = useState(false); // marcar versión final
  const [uploading, setUploading] = useState(false);
  const vInputRef = useRef(null);

  const normalizeIndexPayload = (resData) => {
    if (Array.isArray(resData)) {
      return {
        data: resData.slice(0, PER_PAGE),
        meta: { current_page: 1, last_page: 1, total: resData.length }
      };
    }
    if (resData?.data && resData?.meta) {
      return { data: resData.data, meta: resData.meta };
    }
    if (resData?.data && resData?.current_page) {
      const { data, current_page, last_page, total } = resData;
      return { data, meta: { current_page, last_page, total } };
    }
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

  const isClosed = (c?.estado || "").toUpperCase() === "CERRADO";
  const formDisabled = uploading || loadingList || isClosed;

  /* ====== Versiones ====== */
  const crearVersion = async (e) => {
    e.preventDefault();
    if (!vFile) return;

    // Confirmación SOLO si cierra negociación
    if (finalizar) {
      const ok = window.confirm(
        "¿Confirmas que esta es la versión FINAL?\n" +
        "Esto cerrará la negociación del convenio."
      );
      if (!ok) return;
    }

    const fd = new FormData();
    fd.append("archivo", vFile);
    if (observ)    fd.append("observaciones", observ);
    if (finalizar) fd.append("final", "1");

    try {
      setUploading(true);
      const { data } = await api.post(`/convenios/${id}/versiones`, fd);
      const nueva = data?.version || null;

      // limpiar
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
          return { ...m, total, last_page: Math.max(1, Math.ceil(total / PER_PAGE)), current_page: 1 };
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

  const reabrirConvenio = async () => {
    const ok = window.confirm(
      "¿Deseas habilitar nuevamente la carga de versiones?\n" +
      "El estado del convenio pasará a NEGOCIACIÓN."
    );
    if (!ok) return;

    try {
      // Preferencia: endpoint dedicado
      await api.post(`/convenios/${id}/reabrir`);
    } catch (e1) {
      // Fallback si el endpoint dedicado no existe
      try {
        await api.patch(`/convenios/${id}/estado`, { estado: "NEGOCIACION" });
      } catch (e2) {
        alert(
          e2.response?.data?.message ||
          e1.response?.data?.message ||
          "No se pudo habilitar nuevamente."
        );
        return;
      }
    }
    // Refrescar cabecera y lista
    await loadConvenio();
    await loadPage(1);
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

      const newTotal = Math.max(0, (meta.total || 1) - 1);
      const newLast  = Math.max(1, Math.ceil(newTotal / PER_PAGE));
      const newPage  = Math.min(page, newLast);

      setMeta((m) => ({ ...m, total: newTotal, last_page: newLast, current_page: newPage }));
      setPage(newPage);

      await loadPage(newPage);
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

      {/* ====== Versiones ====== */}
      <div className="card" style={{marginTop:14}}>
        <h3 style={{marginTop:0}}>Versiones</h3>

        {/* Banner de bloqueo cuando está CERRADO */}
        {isClosed && (
          <div
            className="card"
            style={{
              background:"rgba(234,179,8,.12)",
              borderColor:"rgba(234,179,8,.45)",
              display:"flex",
              alignItems:"center",
              justifyContent:"space-between",
              gap:12,
              padding:12,
              marginBottom:10,
            }}
          >
            <div style={{fontSize:14}}>
              <strong>Convenio cerrado.</strong> No es posible subir nuevas versiones.
            </div>
            <button className="btn" style={BTN.warn} onClick={reabrirConvenio}>
              Habilitar nuevamente
            </button>
          </div>
        )}

        {/* Nueva versión — layout claro */}
        <form onSubmit={crearVersion} style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:12 }}>
          {/* Selector de archivo */}
          <div style={{gridColumn:"1 / span 1"}}>
            <label style={{display:"block", fontWeight:700, marginBottom:6}}>Archivo</label>
            <input
              ref={vInputRef}
              id="vfile"
              type="file"
              accept=".pdf,.docx"
              onChange={(e)=>setVFile(e.target.files?.[0]||null)}
              style={{ display:"none" }}
              disabled={formDisabled}
            />
            <div style={{display:"flex", gap:8, alignItems:"center", flexWrap:"wrap"}}>
              <label htmlFor="vfile" className="btn" style={{...BTN.info, ...(formDisabled ? BTN.disabled : {})}}>
                Seleccionar archivo
              </label>
              <span style={{opacity:.9}}>
                {vFile ? vFile.name : "Ningún archivo seleccionado"}
              </span>
            </div>
            <div style={{fontSize:12, opacity:.8, marginTop:6}}>
              Formatos permitidos: PDF o DOCX. Tamaño máx. 20MB.
            </div>
          </div>

          {/* Observaciones grande */}
          <div style={{gridColumn:"2 / span 1"}}>
            <label style={{display:"block", fontWeight:700, marginBottom:6}}>Observaciones</label>
            <textarea
              rows={4}
              placeholder="Detalles opcionales de esta versión…"
              value={observ}
              onChange={(e)=>setObserv(e.target.value)}
              style={{
                width:"100%",
                padding:"10px 12px",
                borderRadius:10,
                minHeight:96
              }}
              disabled={formDisabled}
            />
          </div>

          {/* Bloque versión final + botón acciones */}
          <div style={{gridColumn:"1 / span 2", display:"flex", gap:12, alignItems:"center", flexWrap:"wrap"}}>
            <label
              style={{
                display:"inline-flex",
                alignItems:"center",
                gap:10,
                padding:"10px 12px",
                borderRadius:10,
                background:"rgba(234,179,8,.12)",
                boxShadow:"0 0 0 1px rgba(234,179,8,.35) inset",
                cursor: formDisabled ? "not-allowed" : "pointer",
                opacity: formDisabled ? .6 : 1
              }}
              title="Marca esta casilla si esta versión es la final. Se cerrará la negociación."
            >
              <input
                type="checkbox"
                checked={finalizar}
                onChange={(e)=>setFinalizar(e.target.checked)}
                style={{ width:18, height:18 }}
                disabled={formDisabled}
              />
              <div style={{display:"grid"}}>
                <strong style={{lineHeight:1}}>Marcar como versión FINAL</strong>
                <span style={{fontSize:12, opacity:.9}}>Cierra la negociación del convenio</span>
              </div>
            </label>

            <button
              type="submit"
              className="btn"
              style={{
                ...BTN.action,
                ...((!vFile || uploading || formDisabled) ? BTN.disabled : {})
              }}
              disabled={!vFile || uploading || formDisabled}
            >
              {uploading ? "Subiendo..." : "Agregar versión"}
            </button>
          </div>
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
                    <td>{v.observaciones || "—"}</td>
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

        {/* Paginación */}
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