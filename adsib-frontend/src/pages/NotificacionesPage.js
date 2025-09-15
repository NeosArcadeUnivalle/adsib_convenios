import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api";

const fmt = (s)=> (s ? String(s).slice(0,10) : "—");
const daysOver = (dateStr) => {
  if (!dateStr) return null;
  const [y,m,d]=String(dateStr).slice(0,10).split("-").map(Number);
  const end = new Date(y,(m||1)-1,d||1);
  const t = new Date(); t.setHours(0,0,0,0);
  const diff = Math.round((end - t)/86400000);
  return diff; // negativo=atrasado
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
                  <tr key={v.id} style={{ background: (d<=0) ? "#3a0000ff" : undefined }}>
                    <td>{v.titulo}</td>
                    <td align="center">{v.estado||"—"}</td>
                    <td align="center">{fmt(v.fecha_vencimiento)}</td>
                    <td align="center">{d===0? "hoy" : (d<0? `hace ${Math.abs(d)}d` : `${d}d`)}</td>
                    <td align="right"><Link to={`/convenios/${v.id}`}>Ver</Link></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* --- Filtros de notificaciones --- */}
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
        <button className="btn" onClick={marcarTodas}>Marcar todas como leídas</button>
      </div>

      {/* --- Lista de notificaciones --- */}
      <div className="card">
        <table className="table">
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
                <td align="center"><span className="pill">{n.tipo}</span></td>
                <td align="center">
                  {n.convenio
                    ? <Link to={`/convenios/${n.convenio.id}`}>{n.convenio.titulo}</Link>
                    : "—"}
                </td>
                <td align="center">{fmt(n.fecha_envio)}</td>
                <td align="right" style={{ whiteSpace:"nowrap" }}>
                  {n.leido
                    ? <button className="btn" onClick={()=>marcarLeida(n.id,false)}>Marcar no leída</button>
                    : <button className="btn btn-primary" onClick={()=>marcarLeida(n.id,true)}>Marcar leída</button>}
                  <button className="btn btn-danger" style={{marginLeft:6}} onClick={()=>eliminar(n.id)}>Eliminar</button>
                </td>
              </tr>
            ))}
            {rows.length===0 && <tr><td colSpan={5} className="muted">Sin notificaciones.</td></tr>}
          </tbody>
        </table>
      </div>

      {/* Paginación sencilla */}
      <div className="toolbar" style={{justifyContent:"center"}}>
        <button className="btn" disabled={f.page<=1} onClick={()=>setF(s=>({...s, page:s.page-1}))}>Anterior</button>
        <span style={{padding:"0 10px"}}>Página {f.page} / {meta.last_page}</span>
        <button className="btn" disabled={f.page>=meta.last_page} onClick={()=>setF(s=>({...s, page:s.page+1}))}>Siguiente</button>
      </div>
    </div>
  );
}