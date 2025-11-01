import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import api from "../api";
 
/* Paleta local para este formulario (sin modificar AppShell.css) */
const BTN = {
  back:   { background:"#374151", borderColor:"#4b5563", color:"#e5e7eb" }, // gris
  create: { background:"#1a7927ff", borderColor:"#15803d", color:"#fff" },  // verde
};
 
// Regex unicode con fallback para el título
let tituloAllowedRe, stripNotAllowedRe;
try {
  tituloAllowedRe = new RegExp("^[\\p{L}\\p{N}\\s._,:()/-]+$", "u");
  stripNotAllowedRe = new RegExp("[^\\p{L}\\p{N}\\s._,:()/-]+", "gu");
} catch {
  tituloAllowedRe = /^[A-Za-zÀ-ÿ0-9\s._,:()/-]+$/;
  stripNotAllowedRe = /[^A-Za-zÀ-ÿ0-9\s._,:()/-]+/g;
}
 
export default function ConvenioCreate(){
  const nav = useNavigate();
  const [f, setF] = useState({
    titulo:"", descripcion:"", fecha_firma:"", fecha_vencimiento:""
  });
  const [archivo, setArchivo] = useState(null);
  const [errors, setErrors] = useState({});
 
  const onKeyDownTitulo = (e) => {
    const k = e.key;
    const ctrl = e.ctrlKey || e.metaKey;
    const navKeys = ["Backspace","Delete","ArrowLeft","ArrowRight","Home","End","Tab","Enter"];
    if (navKeys.includes(k) || ctrl) return;
    if (k.length === 1) {
      const next = (f.titulo || "") + k;
      if (!tituloAllowedRe.test(next)) e.preventDefault();
    }
  };
  const onPasteSanitize = (e) => {
    const text = (e.clipboardData || window.clipboardData).getData("text") || "";
    const clean = text.replace(stripNotAllowedRe, " ").replace(/\s+/g, " ").trim();
    e.preventDefault();
    setF(s => ({ ...s, titulo: (s.titulo + (s.titulo ? " " : "") + clean).trim() }));
  };
 
  const validate = () => {
    const errs = {};
    const titulo = (f.titulo || "").trim();
    if (!titulo) errs.titulo = "El título es obligatorio.";
    else if (titulo.length < 3) errs.titulo = "Mínimo 3 caracteres.";
    else if (titulo.length > 200) errs.titulo = "Máximo 200 caracteres.";
    else if (!tituloAllowedRe.test(titulo)) errs.titulo = "Hay caracteres no permitidos.";
 
    if (f.descripcion && f.descripcion.length > 4000) errs.descripcion = "Máximo 4000 caracteres.";
    if (f.fecha_firma && isNaN(new Date(f.fecha_firma).getTime())) errs.fecha_firma = "Fecha inválida.";
    if (f.fecha_vencimiento && isNaN(new Date(f.fecha_vencimiento).getTime())) errs.fecha_vencimiento = "Fecha inválida.";
    if (f.fecha_firma && f.fecha_vencimiento && f.fecha_vencimiento < f.fecha_firma)
      errs.fecha_vencimiento = "La fecha de vencimiento no puede ser menor a la de firma.";
 
    if (archivo) {
      const ext = (archivo.name.split(".").pop() || "").toLowerCase();
      if (!["pdf","docx"].includes(ext)) errs.archivo = "El archivo debe ser PDF o DOCX.";
      if (archivo.size > 20 * 1024 * 1024) errs.archivo = "Máximo 20MB.";
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };
 
  const submit = async (e)=>{
    e.preventDefault();
    if(!validate()) return;
 
    const fd = new FormData();
    fd.append("titulo", f.titulo.trim());
    if(f.descripcion)        fd.append("descripcion", f.descripcion);
    if(f.fecha_firma)        fd.append("fecha_firma", f.fecha_firma);
    if(f.fecha_vencimiento)  fd.append("fecha_vencimiento", f.fecha_vencimiento);
    if(archivo)              fd.append("archivo", archivo);
 
    try {
      const { data } = await api.post("/convenios", fd);
      // backend fija estado automáticamente:
      // - con archivo => NEGOCIACION y genera v1 con observación "Archivo inicial"
      // - sin archivo => BORRADOR
      nav(`/convenios/${data.id}`);
    } catch (er) {
      const v = er.response?.data?.errors || {};
      setErrors({
        ...v,
        general: er.response?.data?.message || "No se pudo crear el convenio."
      });
    }
  };
 
  return (
    <div className="card" style={{ padding:20 }}>
      {/* Header: Volver + Título */}
      <div style={{display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14}}>
        <Link to="/" className="btn" style={BTN.back}>Volver</Link>
        <h2 style={{margin:0}}>Nuevo Convenio</h2>
        <span />
      </div>
 
      {errors.general && (
        <div style={{background:"#ffe4e6",border:"1px solid #ffb4bb",padding:8,borderRadius:6, marginBottom:12}}>
          {errors.general}
        </div>
      )}
 
      {/* Formulario */}
      <form onSubmit={submit} style={{ display:"grid", gap:12, gridTemplateColumns:"repeat(12, 1fr)" }}>
        {/* Título */}
        <div style={{gridColumn:"1 / span 12"}}>
          <label style={{display:"block", marginBottom:6}}>Título</label>
            <input
              value={f.titulo}
              onKeyDown={onKeyDownTitulo}
              onPaste={onPasteSanitize}
              onChange={(e)=>setF(s=>({...s,titulo:e.target.value}))}
              placeholder="Escribe un título descriptivo…"
              /* 👇 ancho completo + mejor usabilidad */
              style={{
                width: "100%",
                maxWidth: "980px",     // respetará el ancho de la card; ajústalo si quieres
                padding: "12px 14px",
                fontSize: 16,
                lineHeight: 1.4,
                borderRadius: 10
              }}
            />
          {errors.titulo && <div style={{color:"#b91c1c"}}>{errors.titulo}</div>}
        </div>
 
        {/* Fechas */}
        <div style={{gridColumn:"1 / span 6", minWidth:220}}>
          <label style={{display:"block", marginBottom:6}}>Fecha firma</label>
          <input type="date" value={f.fecha_firma}
            onChange={(e)=>setF(s=>({...s,fecha_firma:e.target.value}))} />
          {errors.fecha_firma && <div style={{color:"#b91c1c"}}>{errors.fecha_firma}</div>}
        </div>
        <div style={{gridColumn:"7 / span 6", minWidth:220}}>
          <label style={{display:"block", marginBottom:6}}>Fecha vencimiento</label>
          <input type="date" value={f.fecha_vencimiento}
            onChange={(e)=>setF(s=>({...s,fecha_vencimiento:e.target.value}))} />
          {errors.fecha_vencimiento && <div style={{color:"#b91c1c"}}>{errors.fecha_vencimiento}</div>}
        </div>
 
        {/* Descripción */}
        <div style={{gridColumn:"1 / span 12"}}>
          <label style={{display:"block", marginBottom:6}}>Descripción</label>
          <textarea rows={4} value={f.descripcion}
            placeholder="Detalles breves del convenio (opcional)…"
            onChange={(e)=>setF(s=>({...s,descripcion:e.target.value}))} />
          {errors.descripcion && <div style={{color:"#b91c1c"}}>{errors.descripcion}</div>}
        </div>
 
        {/* Archivo */}
        <div style={{gridColumn:"1 / span 12"}}>
          <label style={{display:"block", marginBottom:6}}>Archivo (PDF/DOCX)</label>
          <input type="file" accept=".pdf,.docx"
            onChange={(e)=>setArchivo(e.target.files?.[0]||null)} />
          <div style={{fontSize:12, opacity:.8, marginTop:4}}>
            Si adjuntas un archivo, el convenio iniciará en estado <b>NEGOCIACION</b> y se creará la versión 1 con observación “Archivo inicial”.
          </div>
          {errors.archivo && <div style={{color:"#b91c1c"}}>{errors.archivo}</div>}
        </div>
 
        {/* Acciones */}
        <div style={{gridColumn:"1 / span 12", display:"flex", justifyContent:"flex-end", gap:8, marginTop:4}}>
          <button type="submit" className="btn" style={BTN.create}>Crear</button>
        </div>
      </form>
    </div>
  );
}