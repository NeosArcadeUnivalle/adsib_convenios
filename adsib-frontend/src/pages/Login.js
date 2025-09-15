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
    e.preventDefault();
    setErr("");

    if (!emailRe.test(f.email)) return setErr("Correo inválido.");
    if (f.password.length < 8) return setErr("La contraseña debe tener al menos 8 caracteres.");

    try {
      const { data } = await api.post("/auth/login", f);
      setToken(data.token);
      nav("/");
    } catch (er) {
      setErr(er.response?.data?.message || "No se pudo iniciar sesión.");
    }
  };

  // ===== estilos mínimos y responsive =====
  const card = {
    width: "clamp(280px, 92vw, 440px)",
    margin: "min(8vh, 60px) auto",
    padding: 20,
    border: "1px solid rgba(255,255,255,.15)",
    borderRadius: 12,
    // 👇 quitamos el scroll interno para evitar barra lateral en la tarjeta
    // maxHeight / overflowY eliminados
  };
  const errorBox = {
    background: "#fee2e2",
    color: "#7f1d1d",
    border: "1px solid #fecaca",
    padding: 10,
    borderRadius: 8,
    marginBottom: 10,
  };

  return (
    <div style={card}>
      <h2 style={{ marginTop: 0, textAlign: "center", fontSize: "clamp(22px, 3.2vw, 28px)" }}>
        Iniciar sesión
      </h2>

      {/* Logo centrado y redondo. Pon el archivo en /public/adsib-logo.jpg */}
      <img
        src="/adsib.jpg"
        alt="ADSIB"
        style={{
          width: "min(140px, 40vw)",
          height: "min(140px, 40vw)",
          objectFit: "cover",
          borderRadius: "50%",
          display: "block",
          margin: "12px auto 16px",
          border: "2px solid rgba(255,255,255,.25)",
        }}
      />

      {err && <div style={errorBox}>{err}</div>}

      <form onSubmit={submit} style={{ display: "grid", gap: 12 }}>
        <label>
          Correo
          <input
            type="email"
            value={f.email}
            onKeyDown={onKeyDownNoSpaces}
            onChange={(e) => setF((s) => ({ ...s, email: e.target.value.trim() }))}
            placeholder="usuario@dominio.com"
            required
            autoComplete="username"
            style={{ width: "100%" }}
          />
        </label>

        <label>
          Contraseña
          <input
            type="password"
            value={f.password}
            onKeyDown={onKeyDownNoSpaces}
            onChange={(e) => setF((s) => ({ ...s, password: e.target.value }))}
            minLength={8}
            placeholder="••••••••"
            required
            autoComplete="current-password"
            style={{ width: "100%" }}
          />
        </label>

        <button>Ingresar</button>
      </form>
    </div>
  );
}