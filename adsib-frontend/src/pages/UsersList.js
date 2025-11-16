import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api";

// Formatear sólo la FECHA (YYYY-MM-DD)
const fmt = (s) => {
  if (!s) return "—";
  const str = String(s);
  // Soporta "2025-11-16T03:55:14" o "2025-11-16 03:55:14"
  if (str.includes("T") || str.includes(" ")) {
    return str.split(/[ T]/)[0];
  }
  // Si por alguna razón viene solo la fecha o algo raro
  return str.slice(0, 10);
};

/* Paleta local para botones (consistente con otras pantallas) */
const BTN = {
  info:     { background:"#0ea5e9", borderColor:"#0284c7", color:"#fff" },
  warn:     { background:"#eab308", borderColor:"#a16207", color:"#000000ff" },
  danger:   { background:"#dc2626", borderColor:"#b91c1c", color:"#fff" },
  neutral:  { background:"#374151", borderColor:"#4b5563", color:"#e5e7eb" },
  primary:  { background:"#1a7927ff", borderColor:"#14691fff", color:"#fff" },
  disabled: { opacity:.7, cursor:"not-allowed" },
};

export default function UsersList(){
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ last_page: 1 });
  const [f, setF] = useState({ q:"", page:1, per_page:5 }); // 👈 ahora 5 por página

  const qs = useMemo(()=>{
    const p = new URLSearchParams();
    if (f.q) p.set("q", f.q);
    p.set("page", f.page);
    p.set("per_page", f.per_page);
    return p.toString();
  },[f]);

  useEffect(()=>{
    let alive = true;
    api.get(`/usuarios?${qs}`)
      .then(r=>{
        if(!alive) return;
        setRows(r.data.data || []);
        setMeta({ last_page: r.data.last_page || 1 });
      })
      .catch(console.error);
    return ()=>{ alive=false; };
  },[qs]);

  const eliminar = async(id)=>{
    if(!window.confirm("¿Eliminar este usuario?")) return;
    await api.delete(`/usuarios/${id}`);

    // Después de eliminar, recargar la página actual para que el paginador
    // y el listado queden sincronizados con el backend
    try {
      const { data } = await api.get(`/usuarios?${qs}`);
      setRows(data.data || []);
      setMeta({ last_page: data.last_page || 1 });
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="container">
      <h2>Usuarios</h2>

      {/* Filtros / acciones */}
      <div className="toolbar" style={{gap:8}}>
        <input
          className="input"
          placeholder="Buscar por nombre o email…"
          value={f.q}
          onChange={e=>setF(s=>({...s, q:e.target.value, page:1}))}
        />
        <div style={{flex:1}}/>
        <Link to="/usuarios/nuevo" className="btn" style={BTN.primary}>
          Nuevo Usuario
        </Link>
      </div>

      {/* Tabla */}
      <div className="card">
        <table className="table" style={{minWidth:820}}>
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
                  <Link
                    to={`/usuarios/${u.id}/editar`}
                    className="btn"
                    style={BTN.warn}
                  >
                    Editar
                  </Link>
                  <button
                    className="btn"
                    style={{...BTN.danger, marginLeft:6}}
                    onClick={()=>eliminar(u.id)}
                  >
                    Eliminar
                  </button>
                </td>
              </tr>
            ))}
            {rows.length===0 && (
              <tr><td colSpan={4} className="muted">Sin resultados.</td></tr>
            )}
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