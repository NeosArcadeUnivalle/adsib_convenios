import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api";

const fmt = (s)=> s ? String(s).slice(0,19).replace('T',' ') : "—";

export default function UsersList(){
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ last_page: 1 });
  const [f, setF] = useState({ q:"", page:1, per_page:10 });

  const qs = useMemo(()=>{
    const p = new URLSearchParams();
    if (f.q) p.set('q', f.q);
    p.set('page', f.page);
    p.set('per_page', f.per_page);
    return p.toString();
  },[f]);

  useEffect(()=>{
    let alive = true;
    api.get(`/usuarios?${qs}`).then(r=>{
      if(!alive) return;
      setRows(r.data.data || []);
      setMeta({ last_page: r.data.last_page || 1 });
    });
    return ()=>{ alive=false; };
  },[qs]);

  const eliminar = async(id)=>{
    if(!window.confirm("¿Eliminar este usuario?")) return;
    await api.delete(`/usuarios/${id}`);
    setRows(x=>x.filter(r=>r.id!==id));
  };

  return (
    <div className="container">
      <h2>Usuarios</h2>

      <div className="toolbar" style={{gap:8}}>
        <input className="input" placeholder="Buscar por nombre o email…"
               value={f.q} onChange={e=>setF(s=>({...s, q:e.target.value, page:1}))}/>
        <div style={{flex:1}}/>
        <Link to="/usuarios/nuevo"><button className="btn btn-primary">+ Nuevo usuario</button></Link>
      </div>

      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th align="left">Nombre</th>
              <th align="left">Email</th>
              <th>Creado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(u=>(
              <tr key={u.id}>
                <td>{u.nombre}</td>
                <td>{u.email}</td>
                <td align="center">{fmt(u.created_at)}</td>
                <td align="right" style={{whiteSpace:"nowrap"}}>
                  <Link to={`/usuarios/${u.id}/editar`}>Editar</Link>{" "}
                  <button className="btn btn-danger" onClick={()=>eliminar(u.id)} style={{marginLeft:6}}>Eliminar</button>
                </td>
              </tr>
            ))}
            {rows.length===0 && <tr><td colSpan={4} className="muted">Sin resultados.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="toolbar" style={{justifyContent:"center"}}>
        <button className="btn" disabled={f.page<=1} onClick={()=>setF(s=>({...s, page:s.page-1}))}>Anterior</button>
        <span style={{padding:"0 10px"}}>Página {f.page} / {meta.last_page}</span>
        <button className="btn" disabled={f.page>=meta.last_page} onClick={()=>setF(s=>({...s, page:s.page+1}))}>Siguiente</button>
      </div>
    </div>
  );
}