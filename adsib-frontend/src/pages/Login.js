import { useState } from "react";
import { useNavigate } from "react-router-dom";
import api, { setToken } from "../api";

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function Login() {
  const nav = useNavigate();
  const [f, setF] = useState({ email: "", password: "" });
  const [err, setErr] = useState("");

  const onKeyDownNoSpaces = (e) => {
    if (e.key === " " && e.target.selectionStart === 0) e.preventDefault();
  };

  const submit = async (e) => {
    e.preventDefault(); setErr("");
    if (!emailRe.test(f.email)) return setErr("Correo inválido.");
    if (f.password.length < 6) return setErr("La contraseña debe tener al menos 6 caracteres.");
    try {
      const { data } = await api.post("/auth/login", f);
      setToken(data.token);
      nav("/");
    } catch (er) {
      setErr(er.response?.data?.message || "No se pudo iniciar sesión.");
    }
  };

  return (
    <div style={{maxWidth:380, margin:"60px auto", padding:16, border:"1px solid #eee", borderRadius:10}}>
      <h2>Iniciar sesión</h2>
      {err && <div style={{background:"#ffe4e6", border:"1px solid #ffb4bb", padding:8, borderRadius:6}}>{err}</div>}
      <form onSubmit={submit} style={{display:"grid", gap:10}}>
        <label>Correo
          <input type="email" value={f.email}
            onKeyDown={onKeyDownNoSpaces}
            onChange={(e)=>setF(s=>({...s, email: e.target.value.trim()}))}
            placeholder="usuario@dominio.com" />
        </label>
        <label>Contraseña
          <input type="password" value={f.password}
            onKeyDown={onKeyDownNoSpaces}
            onChange={(e)=>setF(s=>({...s, password: e.target.value}))}
            minLength={6} />
        </label>
        <button>Ingresar</button>
      </form>
    </div>
  );
}