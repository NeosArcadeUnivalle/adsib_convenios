import { useEffect, useState, useCallback } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import api from "../api";

/* Estilos locales para botones */
const BTN = {
  back:    { background:"#374151", borderColor:"#4b5563", color:"#e5e7eb" },
  save:    { background:"#0ea5e9", borderColor:"#0369a1", color:"#fff" },
  saveDis: { background:"#93c5fd", borderColor:"#93c5fd", color:"#1f2937", cursor:"not-allowed", opacity:.9 },
};

// Regex con soporte unicode y fallback
let tituloAllowedRe, stripNotAllowedRe;
try {
  tituloAllowedRe = new RegExp("^[\\p{L}\\p{N}\\s._,:()/-]+$", "u");
  stripNotAllowedRe = new RegExp("[^\\p{L}\\p{N}\\s._,:()/-]+", "gu");
} catch {
  tituloAllowedRe = /^[A-Za-zÀ-ÿ0-9\s._,:()/-]+$/;
  stripNotAllowedRe = /[^A-Za-zÀ-ÿ0-9\s._,:()/-]+/g;
}

export default function ConvenioEdit(){
  const { id } = useParams();
  const nav = useNavigate();
  const [f, setF] = useState({
    titulo:"", descripcion:"", fecha_firma:"", fecha_vencimiento:""
  });
  const [archivo, setArchivo] = useState(null);
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    const { data } = await api.get(`/convenios/${id}`);
    setF({
      titulo: data.titulo || "",
      descripcion: data.descripcion || "",
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
    if (f.descripcion)        fd.append("descripcion", f.descripcion);
    if (f.fecha_firma)        fd.append("fecha_firma", f.fecha_firma);
    if (f.fecha_vencimiento)  fd.append("fecha_vencimiento", f.fecha_vencimiento);
    if (archivo) {
      fd.append("archivo", archivo);
      // 👇 Indica explícitamente al backend que debe reemplazar archivo base y v1 (sin crear nueva versión)
      fd.append("replace_strategy", "base_and_v1");
    }

    try {
      setLoading(true);
      await api.post(`/convenios/${id}?&_method=PUT`, fd); // PUT via form-data
      nav(`/convenios/${id}`);
    } catch (er) {
      const v = er.response?.data?.errors || {};
      setErrors({ ...v, general: er.response?.data?.message || "No se pudo actualizar." });
    } finally { setLoading(false); }
  };

  return (
    <div className="card" style={{ padding:20 }}>
      {/* Header con botón Volver y título */}
      <div style={{display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14}}>
        <Link to="/" className="btn" style={BTN.back}>Volver</Link>
        <h2 style={{margin:0}}>Editar Convenio</h2>
        <span />
      </div>

      {errors.general && (
        <div style={{background:"#ffe4e6",border:"1px solid #ffb4bb",padding:8,borderRadius:6, marginBottom:12}}>
          {errors.general}
        </div>
      )}

      <form onSubmit={submit} style={{ display:"grid", gap:12, gridTemplateColumns:"repeat(12, 1fr)" }}>
        {/* Título */}
        <div style={{gridColumn:"1 / span 12"}}>
          <label style={{display:"block", marginBottom:6}}>Título</label>
            <input
              value={f.titulo}
              onKeyDown={onKeyDownTitulo}
              onPaste={onPasteSanitize}
              onChange={(e)=>setF(s=>({...s,titulo:e.target.value}))}
              placeholder="Edita el título del convenio…"
              /* 👇 ancho completo + mejor usabilidad */
              style={{
                width: "100%",
                maxWidth: "980px",
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
            placeholder="Actualiza los detalles del convenio…"
            onChange={(e)=>setF(s=>({...s,descripcion:e.target.value}))} />
          {errors.descripcion && <div style={{color:"#b91c1c"}}>{errors.descripcion}</div>}
        </div>

        {/* Archivo */}
        <div style={{gridColumn:"1 / span 12"}}>
          <label style={{display:"block", marginBottom:6}}>Reemplazar archivo (PDF/DOCX)</label>
          <input type="file" accept=".pdf,.docx" onChange={(e)=>setArchivo(e.target.files?.[0]||null)} />
          <div style={{fontSize:12, opacity:.8, marginTop:4}}>
            Si adjuntas un archivo aquí, <b>no</b> se creará una nueva versión:
            se <b>reemplazará</b> el <b>archivo base del convenio</b> y también el de la
            <b> versión 1 (v1)</b>. Deja vacío si no quieres reemplazar el archivo actual.
          </div>
          {errors.archivo && <div style={{color:"#b91c1c"}}>{errors.archivo}</div>}
        </div>

        {/* Acciones */}
        <div style={{gridColumn:"1 / span 12", display:"flex", justifyContent:"flex-end", gap:8, marginTop:4}}>
          <button type="submit" className="btn" style={loading ? BTN.saveDis : BTN.save} disabled={loading}>
            {loading ? "Guardando…" : "Guardar cambios"}
          </button>
        </div>
      </form>
    </div>
  );
}