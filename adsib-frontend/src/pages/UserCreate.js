import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api from "../api";

export default function UserCreate(){
  const nav = useNavigate();
  const [f, setF] = useState({ nombre:"", email:"", password:"", password_confirmation:"" });
  const [err, setErr] = useState({});

  const submit = async(e)=>{
    e.preventDefault(); setErr({});
    try{
      await api.post("/usuarios", f);
      nav("/usuarios");
    }catch(ex){
      const e = ex.response?.data?.errors || {};
      setErr(e);
      alert(ex.response?.data?.message || "No se pudo crear el usuario");
    }
  };

  return (
    <div className="container">
      <p><Link to="/usuarios">← Volver</Link></p>
      <h2>Nuevo usuario</h2>

      <form className="card" onSubmit={submit}>
        <label>Nombre
          <input className="input" value={f.nombre} onChange={e=>setF({...f, nombre:e.target.value})} required />
        </label>
        {err.nombre && <small className="muted">{err.nombre[0]}</small>}

        <label>Email
          <input className="input" type="email" value={f.email} onChange={e=>setF({...f, email:e.target.value})} required />
        </label>
        {err.email && <small className="muted">{err.email[0]}</small>}

        <div className="grid" style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:12}}>
          <label>Contraseña
            <input className="input" type="password" value={f.password} onChange={e=>setF({...f, password:e.target.value})} required />
          </label>
          <label>Confirmar contraseña
            <input className="input" type="password" value={f.password_confirmation} onChange={e=>setF({...f, password_confirmation:e.target.value})} required />
          </label>
        </div>
        {err.password && <small className="muted">{err.password[0]}</small>}

        <div className="toolbar" style={{justifyContent:"flex-end"}}>
          <button className="btn btn-primary">Crear</button>
        </div>
      </form>
    </div>
  );
}