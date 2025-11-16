import { useState } from "react";
import { useNavigate } from "react-router-dom";
import api, { setToken } from "../api";

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function Login() {
  const nav = useNavigate();
  const [f, setF] = useState({ email: "", password: "" });
  const [err, setErr] = useState("");
  const [hover, setHover] = useState(false);
  const [showPass, setShowPass] = useState(false); // 👁️

  const onKeyDownNoSpaces = (e) => {
    if (e.key === " " && e.target.selectionStart === 0) e.preventDefault();
  };

  const submit = async (e) => {
    e.preventDefault();
    setErr("");

    if (!emailRe.test(f.email)) return setErr("Correo inválido.");
    if (f.password.length < 8)
      return setErr("La contraseña debe tener al menos 8 caracteres.");

    try {
      const { data } = await api.post("/auth/login", f);
      setToken(data.token);
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

  const linkStyle = {
    marginTop: 10,
    textAlign: "center",
    fontSize: 14,
    color: "#0d839bff",
    cursor: "pointer",
    textDecoration: "underline",
  };

  // Íconos SVG
  const eyeOpen = (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#ccc"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );

  const eyeClosed = (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#ccc"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* mismo ojo que el abierto */}
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12Z" />
      <circle cx="12" cy="12" r="3" />
      {/* línea diagonal para “oculto” */}
      <path d="M3 3l18 18" />
    </svg>
  );

  const eyeBtn = {
    position: "absolute",
    right: 10,
    top: "40%",
    transform: "translateY(-50%)",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  };

  return (
    <div style={card}>
      <h2
        style={{
          marginTop: 0,
          textAlign: "center",
          fontSize: "clamp(22px, 3.2vw, 28px)",
        }}
      >
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
        {/* EMAIL */}
        <label>
          Correo
          <input
            type="email"
            value={f.email}
            onKeyDown={onKeyDownNoSpaces}
            onChange={(e) =>
              setF((s) => ({ ...s, email: e.target.value.trim() }))
            }
            placeholder="usuario@dominio.com"
            required
            autoComplete="username"
            style={{ width: "100%" }}
          />
        </label>

        {/* PASSWORD + OJO */}
        <label>
          Contraseña
          {/* contenedor SOLO para el input, así el ojo se centra con el campo */}
          <div style={{ position: "relative" }}>
            <input
              type={showPass ? "text" : "password"}
              value={f.password}
              onKeyDown={onKeyDownNoSpaces}
              onChange={(e) =>
                setF((s) => ({ ...s, password: e.target.value }))
              }
              minLength={8}
              placeholder="••••••••"
              required
              autoComplete="current-password"
              style={{ width: "100%", paddingRight: 40 }}
            />

            {/* Ícono alineado al centro del input */}
            <button
              type="button"
              onClick={() => setShowPass((s) => !s)}
              style={{
                ...eyeBtn,
                background: "transparent",
                border: "none",
                padding: 0,
                outline: "none",
              }}
            >
              {showPass ? eyeClosed : eyeOpen}
            </button>
          </div>
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

      {/* Recuperar contraseña */}
      <div style={linkStyle} onClick={() => nav("/recuperar-contraseña")}>
        ¿Olvidaste tu contraseña?
      </div>
    </div>
  );
}