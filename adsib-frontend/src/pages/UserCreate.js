import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api from "../api";

/* Paleta local (sin tocar AppShell.css) */
const BTN = {
  primary:  { background:"#1a6779", borderColor:"#125463", color:"#fff" },
  neutral:  { background:"#374151", borderColor:"#4b5563", color:"#e5e7eb" },
  disabled: { opacity:.7, cursor:"not-allowed" },
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export default function UserCreate(){
  const nav = useNavigate();
  const [f, setF] = useState({
    nombre: "",
    email: "",
    password: "",
    password_confirmation: ""
  });
  const [err, setErr] = useState({});
  const [loading, setLoading] = useState(false);

  const validate = () => {
    const e = {};
    if (!f.nombre.trim()) e.nombre = ["El nombre es obligatorio."];
    const em = f.email.trim();
    if (!em) e.email = ["El email es obligatorio."];
    else if (!EMAIL_RE.test(em)) e.email = ["Ingresa un email válido."];

    if (f.password !== f.password_confirmation) {
      e.password_confirmation = ["Las contraseñas no coinciden."];
    }
    setErr(e);
    return Object.keys(e).length === 0;
  };

  const submit = async (e) => {
    e.preventDefault();
    setErr({});
    if (!validate()) return;
    try {
      setLoading(true);
      await api.post("/usuarios", {
        ...f,
        nombre: f.nombre.trim(),
        email: f.email.trim(),
      });
      nav("/usuarios");
    } catch (ex) {
      const e = ex.response?.data?.errors || {};
      setErr(e);
      alert(ex.response?.data?.message || "No se pudo crear el usuario");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container">
      <div className="toolbar" style={{ gap: 8, marginBottom: 8 }}>
        <Link to="/usuarios" className="btn" style={BTN.neutral}>← Volver</Link>
      </div>

      <h2>Nuevo usuario</h2>

      <form onSubmit={submit} className="card" style={{ display:"grid", gap:14 }}>
        <label style={{ display:"grid", gap:6 }}>
          <span>Nombre</span>
          <input
            className="input"
            value={f.nombre}
            onChange={(e)=>setF({ ...f, nombre: e.target.value })}
            autoComplete="name"
            required
          />
          {err.nombre && <small style={{ color:"#be3232ff" }}>{err.nombre[0]}</small>}
        </label>

        <label style={{ display:"grid", gap:6 }}>
          <span>Email</span>
          <input
            className="input"
            type="email"
            value={f.email}
            onChange={(e)=>setF({ ...f, email: e.target.value })}
            autoComplete="email"
            required
          />
          {err.email && <small style={{ color:"#be3232ff" }}>{err.email[0]}</small>}
        </label>

        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
          <label style={{ display:"grid", gap:6 }}>
            <span>Contraseña</span>
            <input
              className="input"
              type="password"
              value={f.password}
              onChange={(e)=>setF({ ...f, password: e.target.value })}
              autoComplete="new-password"
              required
            />
          </label>
          <label style={{ display:"grid", gap:6 }}>
            <span>Confirmar contraseña</span>
            <input
              className="input"
              type="password"
              value={f.password_confirmation}
              onChange={(e)=>setF({ ...f, password_confirmation: e.target.value })}
              autoComplete="new-password"
              required
            />
          </label>
        </div>
        {(err.password || err.password_confirmation) && (
          <small style={{ color:"#be3232ff" }}>
            {err.password?.[0] || err.password_confirmation?.[0]}
          </small>
        )}

        <div className="toolbar" style={{ justifyContent:"flex-end" }}>
          <button
            className="btn"
            style={{ ...BTN.primary, ...(loading ? BTN.disabled : {}) }}
            disabled={loading}
          >
            {loading ? "Creando…" : "Crear"}
          </button>
        </div>
      </form>
    </div>
  );
}