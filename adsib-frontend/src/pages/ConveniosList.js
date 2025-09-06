import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api";

export default function ConveniosList(){
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ last_page:1 });
  const [f, setF] = useState({
    q:"", fi_from:"", fi_to:"", fv_from:"", fv_to:"",
    sort:"fecha_vencimiento", dir:"asc", page:1, per_page:10
  });

  const qs = useMemo(()=>{
    const p = new URLSearchParams();
    if(f.q) p.set("q", f.q);
    if(f.fi_from) p.set("fi_from", f.fi_from);
    if(f.fi_to)   p.set("fi_to", f.fi_to);
    if(f.fv_from) p.set("fv_from", f.fv_from);
    if(f.fv_to)   p.set("fv_to", f.fv_to);
    p.set("sort", f.sort); p.set("dir", f.dir);
    p.set("page", f.page); p.set("per_page", f.per_page);
    return p.toString();
  }, [f]);

  useEffect(()=>{
    api.get(`/convenios?${qs}`).then(r=>{
      setRows(r.data.data); setMeta({ last_page: r.data.last_page || 1 });
    });
  }, [qs]);

  return (
    <div style={{padding:16}}>
      <h2 style={{display:"flex",justifyContent:"space-between"}}>
        Convenios
        <Link to="/convenios/nuevo"><button>+ Nuevo</button></Link>
      </h2>

      {/* filtros */}
      <div style={{display:"grid",gap:8,gridTemplateColumns:"repeat(6,1fr)",margin:"8px 0 12px"}}>
        <input placeholder="Buscar por título/descr..." value={f.q}
               onChange={e=>setF(s=>({...s,q:e.target.value,page:1}))}
               style={{gridColumn:"span 3"}} />
        <select value={f.sort} onChange={e=>setF(s=>({...s,sort:e.target.value}))}>
          <option value="fecha_vencimiento">Vencimiento</option>
          <option value="fecha_firma">Firma</option>
          <option value="titulo">Título</option>
          <option value="updated_at">Actualizado</option>
        </select>
        <select value={f.dir} onChange={e=>setF(s=>({...s,dir:e.target.value}))}>
          <option value="asc">Asc</option><option value="desc">Desc</option>
        </select>
        <input type="number" min={1} max={100} value={f.per_page}
               onChange={e=>setF(s=>({...s,per_page:+e.target.value||10,page:1}))} />

        <div>Firma de: <input type="date" value={f.fi_from} onChange={e=>setF(s=>({...s,fi_from:e.target.value,page:1}))}/></div>
        <div>Firma a:   <input type="date" value={f.fi_to}   onChange={e=>setF(s=>({...s,fi_to:e.target.value,page:1}))}/></div>
        <div>Vence de:  <input type="date" value={f.fv_from} onChange={e=>setF(s=>({...s,fv_from:e.target.value,page:1}))}/></div>
        <div>Vence a:   <input type="date" value={f.fv_to}   onChange={e=>setF(s=>({...s,fv_to:e.target.value,page:1}))}/></div>
      </div>

      <table width="100%" cellPadding={6} style={{borderCollapse:"collapse"}}>
        <thead><tr>
          <th align="left">Título</th>
          <th align="left">Descripción</th>
          <th>Firma</th>
          <th>Vencimiento</th>
          <th>Archivo</th>
          <th></th>
        </tr></thead>
        <tbody>
          {rows.map(r=>(
            <tr key={r.id} style={{borderTop:"1px solid #eee"}}>
              <td>{r.titulo}</td>
              <td>{r.descripcion?.slice(0,60) || "-"}</td>
              <td align="center">{r.fecha_firma || "-"}</td>
              <td align="center">{r.fecha_vencimiento || "-"}</td>
              <td align="center">{r.archivo_nombre_original ? "Sí" : "—"}</td>
              <td><Link to={`/convenios/${r.id}`}>Ver</Link></td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{marginTop:12,display:"flex",gap:8}}>
        <button disabled={f.page<=1} onClick={()=>setF(s=>({...s,page:s.page-1}))}>Anterior</button>
        <span>Página {f.page} / {meta.last_page}</span>
        <button disabled={f.page>=meta.last_page} onClick={()=>setF(s=>({...s,page:s.page+1}))}>Siguiente</button>
      </div>
    </div>
  );
}