import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import api from "../api";

export default function ConvenioCreate(){
  const nav = useNavigate();
  const [f, setF] = useState({
    titulo:"", descripcion:"", fecha_firma:"", fecha_vencimiento:""
  });
  const [archivo, setArchivo] = useState(null);
  const [err, setErr] = useState("");

  const submit = async (e)=>{
    e.preventDefault(); setErr("");
    if(!f.titulo.trim()) return setErr("El título es obligatorio.");
    if(f.fecha_firma && f.fecha_vencimiento && f.fecha_vencimiento < f.fecha_firma)
      return setErr("La fecha de vencimiento no puede ser menor a la de firma.");

    const fd = new FormData();
    fd.append("titulo", f.titulo.trim());
    if(f.descripcion) fd.append("descripcion", f.descripcion);
    if(f.fecha_firma) fd.append("fecha_firma", f.fecha_firma);
    if(f.fecha_vencimiento) fd.append("fecha_vencimiento", f.fecha_vencimiento);
    if(archivo) fd.append("archivo", archivo);

    const { data } = await api.post("/convenios", fd); // NO pongas headers
    nav(`/convenios/${data.id}`);
  };

  return (
    <div style={{padding:16, maxWidth:800, margin:"0 auto"}}>
      <Link to="/">← Volver</Link>
      <h2>Nuevo Convenio</h2>
      {err && <div style={{background:"#ffe4e6",border:"1px solid #ffb4bb",padding:8,borderRadius:6}}>{err}</div>}

      <form onSubmit={submit} style={{display:"grid",gap:10,gridTemplateColumns:"repeat(2,1fr)"}}>
        <label style={{gridColumn:"span 2"}}>Título *<input value={f.titulo} onChange={e=>setF(s=>({...s,titulo:e.target.value}))} /></label>
        <label style={{gridColumn:"span 2"}}>Descripción<textarea rows={3} value={f.descripcion} onChange={e=>setF(s=>({...s,descripcion:e.target.value}))} /></label>
        <label>Fecha firma<input type="date" value={f.fecha_firma} onChange={e=>setF(s=>({...s,fecha_firma:e.target.value}))} /></label>
        <label>Fecha vencimiento<input type="date" value={f.fecha_vencimiento} onChange={e=>setF(s=>({...s,fecha_vencimiento:e.target.value}))} /></label>
        <label style={{gridColumn:"span 2"}}>Archivo (PDF/DOCX)
          <input type="file" accept=".pdf,.docx" onChange={e=>setArchivo(e.target.files?.[0]||null)} />
        </label>
        <div style={{gridColumn:"span 2"}}><button>Crear</button></div>
      </form>
    </div>
  );
}