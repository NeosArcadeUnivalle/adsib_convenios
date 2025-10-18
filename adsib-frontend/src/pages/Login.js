import { useState } from "react";
import { useNavigate } from "react-router-dom";
import api, { setToken } from "../api";

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function Login() {
  const nav = useNavigate();
  const [f, setF] = useState({ email: "", password: "" });
  const [err, setErr] = useState("");
  const [hover, setHover] = useState(false);

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
      // Marca que acabas de iniciar sesión para abrir el popup en Home
      sessionStorage.setItem("just_logged_v2", "1");
      nav("/");
    } catch (er) {
      setErr(er.response?.data?.message || "No se pudo iniciar sesión.");
    }
  };

  const card = {
    width: "clamp(280px, 92vw, 440px)",
    margin: "min(8vh, 60px) auto",
    padding: 20,
    border: "1px solid #1a6779ff",
    borderRadius: 12,
  };
  const errorBox = {
    background: "#b80909ff",
    color: "#ffffffff",
    border: "1px solid #ffffffff",
    padding: 10,
    borderRadius: 8,
    marginBottom: 10,
  };
  const btnStyle = {
    background: hover ? "#0d839bff" : "#1a6779ff",
    color: "#ffffff",
    border: "1px solid #0aa4caff",
    borderRadius: 8,
    padding: "12px 16px",
    fontWeight: 600,
    width: "100%",
    transition: "background .15s ease",
    cursor: "pointer",
  };

  return (
    <div style={card}>
      <h2 style={{ marginTop: 0, textAlign: "center", fontSize: "clamp(22px, 3.2vw, 28px)" }}>
        Iniciar sesión
      </h2>

      <img
        src="/adsib.jpg"
        alt="ADSIB"
        style={{
          width: "min(160px, 42vw)",
          height: "min(160px, 42vw)",
          objectFit: "cover",
          borderRadius: "50%",
          display: "block",
          margin: "12px auto 16px",
          border: "2px solid #1a6779ff",
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

        <button
          type="submit"
          style={btnStyle}
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
        >
          Ingresar
        </button>
      </form>
    </div>
  );
}