import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api";

/* ========= Helpers ========= */
const fmt = (s)=> (s ? String(s).slice(0,10) : "—");
const daysOver = (dateStr) => {
  if (!dateStr) return null;
  const [y,m,d]=String(dateStr).slice(0,10).split("-").map(Number);
  const end = new Date(y,(m||1)-1,d||1);
  const t = new Date(); t.setHours(0,0,0,0);
  const diff = Math.round((end - t)/86400000);
  return diff; // negativo=atrasado
};

/* ========= Estilos locales de botones/pills (no se tocan los globales) ========= */
const BTN = {
  info:     { background:"#0ea5e9", borderColor:"#0284c7", color:"#fff" },
  warn:     { background:"#eab308", borderColor:"#a16207", color:"#1f2937" },
  danger:   { background:"#dc2626", borderColor:"#b91c1c", color:"#fff" },
  neutral:  { background:"#374151", borderColor:"#4b5563", color:"#e5e7eb" },
  primary:  { background:"#1a6779", borderColor:"#125463", color:"#fff" },
  disabled: { opacity:.7, cursor:"not-allowed" },
};

const PILL = (tipo) => {
  const base = { padding:"2px 8px", borderRadius:8, fontSize:12, fontWeight:700, display:"inline-block" };
  switch (tipo) {
    case "VENCIMIENTO": return { ...base, background:"#7f1d1d", color:"#fff" };
    case "RENOVACION":  return { ...base, background:"#14532d", color:"#fff" };
    case "RIESGO":      return { ...base, background:"#7c2d12", color:"#fff" };
    case "SEGUIMIENTO": return { ...base, background:"#1f2937", color:"#e5e7eb" };
    default:            return { ...base, background:"#374151", color:"#e5e7eb" };
  }
};

export default function NotificacionesPage(){
  const [vencidos, setVencidos] = useState([]);
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ last_page:1 });
  const [f, setF] = useState({ q:"", tipo:"", leido:"", page:1, per_page:10 });

  const qs = useMemo(()=>{
    const p = new URLSearchParams();
    if(f.q) p.set("q", f.q);
    if(f.tipo) p.set("tipo", f.tipo);
    if(f.leido!=="") p.set("leido", f.leido);
    p.set("page", f.page); p.set("per_page", f.per_page);
    return p.toString();
  },[f]);

  useEffect(()=>{
    let alive = true;
    (async ()=>{
      const [a,b] = await Promise.all([
        api.get("/notificaciones/vencidos"),
        api.get(`/notificaciones?${qs}`)
      ]);
      if(!alive) return;
      setVencidos(a.data||[]);
      setRows(b.data?.data||[]);
      setMeta({ last_page: b.data?.last_page || 1 });
    })().catch(console.error);
    return ()=>{ alive=false; };
  },[qs]);

  const marcarLeida = async (id, leido=true)=>{
    const { data } = await api.patch(`/notificaciones/${id}/leer`, { leido });
    setRows(r => r.map(x=> x.id===id ? data : x));
  };
  const marcarTodas = async ()=>{
    await api.patch("/notificaciones/leer-todas");
    setRows(r => r.map(x=> ({...x, leido:true})));
  };
  const eliminar = async (id)=>{
    if(!window.confirm("¿Eliminar notificación?")) return;
    await api.delete(`/notificaciones/${id}`);
    setRows(r => r.filter(x=>x.id!==id));
  };

  return (
    <div className="container">
      <h2>Notificaciones</h2>

      {/* --- Sección superior: convenios vencidos --- */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">Convenios vencidos</div>
        {vencidos.length === 0 ? (
          <div className="muted">No hay convenios vencidos.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th align="left">Título</th>
                <th>Estado</th>
                <th>Vencimiento</th>
                <th>Días</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {vencidos.map(v=>{
                const d = daysOver(v.fecha_vencimiento); // <= 0 vencido
                return (
                  <tr key={v.id} style={{ background: (d<=0) ? "#3a0000" : undefined }}>
                    <td>{v.titulo}</td>
                    <td align="center">{v.estado||"—"}</td>
                    <td align="center">{fmt(v.fecha_vencimiento)}</td>
                    <td align="center">{d===0? "hoy" : (d<0? `hace ${Math.abs(d)}d` : `${d}d`)}</td>
                    <td align="right">
                      <Link
                        className="btn"
                        style={BTN.info}
                        to={`/convenios/${v.id}`}
                      >
                        Ver
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* --- Filtros de notificaciones --- */}
      <div className="card" style={{ paddingBottom:12, marginBottom:16 }}>
        <div className="toolbar" style={{gap:8}}>
          <input className="input" placeholder="Buscar en mensaje…" value={f.q} onChange={e=>setF(s=>({...s, q:e.target.value, page:1}))} />
          <select className="select" value={f.tipo} onChange={e=>setF(s=>({...s, tipo:e.target.value, page:1}))}>
            <option value="">Todos los tipos</option>
            <option value="VENCIMIENTO">VENCIMIENTO</option>
            <option value="RENOVACION">RENOVACION</option>
            <option value="RIESGO">RIESGO</option>
            <option value="SEGUIMIENTO">SEGUIMIENTO</option>
          </select>
          <select className="select" value={f.leido} onChange={e=>setF(s=>({...s, leido:e.target.value, page:1}))}>
            <option value="">Todas</option>
            <option value="false">No leídas</option>
            <option value="true">Leídas</option>
          </select>
          <div style={{flex:1}}/>
          <button className="btn" style={BTN.warn} onClick={marcarTodas}>
            Marcar todas como leídas
          </button>
        </div>
      </div>

      {/* --- Lista de notificaciones --- */}
      <div className="card">
        <table className="table" style={{minWidth: 860}}>
          <thead>
            <tr>
              <th align="left">Mensaje</th>
              <th>Tipo</th>
              <th>Convenio</th>
              <th>Fecha</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(n=>(
              <tr key={n.id} style={{ background: n.leido ? undefined : "#e0e7ff55" }}>
                <td>{n.mensaje}</td>
                <td align="center"><span style={PILL(n.tipo)}>{n.tipo}</span></td>
                <td align="center">
                  {n.convenio ? (
                    <Link className="btn" style={BTN.info} to={`/convenios/${n.convenio.id}`}>
                      Ver
                    </Link>
                  ) : "—"}
                </td>
                <td align="center">{fmt(n.fecha_envio)}</td>
                <td align="right" style={{ whiteSpace:"nowrap" }}>
                  {n.leido ? (
                    <button className="btn" style={BTN.neutral} onClick={()=>marcarLeida(n.id,false)}>
                      Marcar no leída
                    </button>
                  ) : (
                    <button className="btn" style={BTN.primary} onClick={()=>marcarLeida(n.id,true)}>
                      Marcar leída
                    </button>
                  )}
                  <button className="btn" style={{...BTN.danger, marginLeft:6}} onClick={()=>eliminar(n.id)}>
                    Eliminar
                  </button>
                </td>
              </tr>
            ))}
            {rows.length===0 && <tr><td colSpan={5} className="muted">Sin notificaciones.</td></tr>}
          </tbody>
        </table>
      </div>

      {/* Paginación */}
      <div className="toolbar" style={{justifyContent:"center"}}>
        <button
          className="btn"
          style={{...BTN.neutral, ...(f.page<=1 ? BTN.disabled : {})}}
          disabled={f.page<=1}
          onClick={()=>setF(s=>({...s, page:s.page-1}))}
        >
          Anterior
        </button>
        <span style={{padding:"0 10px"}}>Página {f.page} / {meta.last_page}</span>
        <button
          className="btn"
          style={{...BTN.neutral, ...(f.page>=meta.last_page ? BTN.disabled : {})}}
          disabled={f.page>=meta.last_page}
          onClick={()=>setF(s=>({...s, page:s.page+1}))}
        >
          Siguiente
        </button>
      </div>
    </div>
  );
}