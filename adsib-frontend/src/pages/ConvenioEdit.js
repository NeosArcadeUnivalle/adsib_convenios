import { useEffect, useState, useCallback } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import api from "../api";

const ESTADOS = ["BORRADOR","NEGOCIACION","VIGENTE","SUSPENDIDO","VENCIDO","RESCINDIDO","CERRADO"];

// Regex con soporte unicode y fallback
let tituloAllowedRe, stripNotAllowedRe;
try {
  tituloAllowedRe = new RegExp("^[\\p{L}\\p{N}\\s._,:()/-]+$", "u");
  stripNotAllowedRe = new RegExp("[^\\p{L}\\p{N}\\s._,:()/-]+", "gu");
} catch (e) {
  tituloAllowedRe = /^[A-Za-zÀ-ÿ0-9\s._,:()/-]+$/;
  stripNotAllowedRe = /[^A-Za-zÀ-ÿ0-9\s._,:()/-]+/g;
}

export default function ConvenioEdit(){
  const { id } = useParams();
  const nav = useNavigate();
  const [f, setF] = useState({
    titulo:"", descripcion:"", estado:"BORRADOR", fecha_firma:"", fecha_vencimiento:""
  });
  const [archivo, setArchivo] = useState(null);
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    const { data } = await api.get(`/convenios/${id}`);
    setF({
      titulo: data.titulo || "",
      descripcion: data.descripcion || "",
      estado: data.estado || "BORRADOR",
      fecha_firma: data.fecha_firma || "",
      fecha_vencimiento: data.fecha_vencimiento || "",
    });
  }, [id]);

  useEffect(() => { load(); }, [load]);

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
    const t = (f.titulo || "").trim();
    if (!t) errs.titulo = "El título es obligatorio.";
    else if (t.length < 3) errs.titulo = "Mínimo 3 caracteres.";
    else if (t.length > 200) errs.titulo = "Máximo 200 caracteres.";
    else if (!tituloAllowedRe.test(t)) errs.titulo = "Hay caracteres no permitidos.";
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

  const submit = async (e) => {
    e.preventDefault();
    if (!validate()) return;

    const fd = new FormData();
    fd.append("titulo", f.titulo.trim());
    fd.append("estado", f.estado);
    if (f.descripcion)       fd.append("descripcion", f.descripcion);
    if (f.fecha_firma)       fd.append("fecha_firma", f.fecha_firma);
    if (f.fecha_vencimiento) fd.append("fecha_vencimiento", f.fecha_vencimiento);
    if (archivo)             fd.append("archivo", archivo);

    try {
      setLoading(true);
      await api.post(`/convenios/${id}?_method=PUT`, fd); // método PUT con form-data
      nav(`/convenios/${id}`);
    } catch (er) {
      const v = er.response?.data?.errors || {};
      setErrors({ ...v, general: er.response?.data?.message || "No se pudo actualizar." });
    } finally { setLoading(false); }
  };

  return (
    <div style={{padding:16, maxWidth:800, margin:"0 auto"}}>
      <Link to="/">← Volver</Link>
      <h2>Editar Convenio</h2>

      {errors.general && (
        <div style={{background:"#ffe4e6",border:"1px solid #ffb4bb",padding:8,borderRadius:6}}>
          {errors.general}
        </div>
      )}

      <form onSubmit={submit} style={{display:"grid",gap:10,gridTemplateColumns:"repeat(2,1fr)"}}>
        <label style={{gridColumn:"span 2"}}>Título *
          <input
            value={f.titulo}
            onKeyDown={onKeyDownTitulo}
            onPaste={onPasteSanitize}
            onChange={(e)=>setF(s=>({...s,titulo:e.target.value}))}
          />
          {errors.titulo && <div style={{color:"#b91c1c"}}>{errors.titulo}</div>}
        </label>

        <label>Estado
          <select value={f.estado} onChange={(e)=>setF(s=>({...s,estado:e.target.value}))}>
            {ESTADOS.map((e)=> <option key={e} value={e}>{e}</option>)}
          </select>
        </label>

        <div></div>

        <label style={{gridColumn:"span 2"}}>Descripción
          <textarea rows={3} value={f.descripcion}
            onChange={(e)=>setF(s=>({...s,descripcion:e.target.value}))} />
          {errors.descripcion && <div style={{color:"#b91c1c"}}>{errors.descripcion}</div>}
        </label>

        <label>Fecha firma
          <input type="date" value={f.fecha_firma}
            onChange={(e)=>setF(s=>({...s,fecha_firma:e.target.value}))} />
          {errors.fecha_firma && <div style={{color:"#b91c1c"}}>{errors.fecha_firma}</div>}
        </label>

        <label>Fecha vencimiento
          <input type="date" value={f.fecha_vencimiento}
            onChange={(e)=>setF(s=>({...s,fecha_vencimiento:e.target.value}))} />
          {errors.fecha_vencimiento && <div style={{color:"#b91c1c"}}>{errors.fecha_vencimiento}</div>}
        </label>

        <label style={{gridColumn:"span 2"}}>Reemplazar archivo (PDF/DOCX)
          <input type="file" accept=".pdf,.docx" onChange={(e)=>setArchivo(e.target.files?.[0]||null)} />
          {errors.archivo && <div style={{color:"#b91c1c"}}>{errors.archivo}</div>}
        </label>

        <div style={{gridColumn:"span 2"}}><button disabled={loading}>Guardar cambios</button></div>
      </form>
    </div>
  );
}