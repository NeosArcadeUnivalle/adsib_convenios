import { useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api";

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function RecoverPassword() {
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const card = {
    width: "clamp(280px, 92vw, 440px)",
    margin: "min(8vh, 60px) auto",
    padding: 20,
    border: "1px solid #1a6779ff",
    borderRadius: 12,
  };
  const box = (bg, col) => ({
    background: bg,
    color: col,
    border: "1px solid #ffffff22",
    padding: 10,
    borderRadius: 8,
    marginBottom: 10,
    fontSize: 14,
  });
  const btnPrimary = {
    background: "#1a6779ff",
    color: "#ffffff",
    border: "1px solid #0aa4caff",
    borderRadius: 8,
    padding: "10px 16px",
    fontWeight: 600,
    width: "100%",
    cursor: "pointer",
    marginTop: 8,
  };
  const btnSecondary = {
    background: "#374151",
    color: "#e5e7eb",
    border: "1px solid #4b5563",
    borderRadius: 8,
    padding: "8px 12px",
    fontWeight: 500,
    cursor: "pointer",
    marginTop: 10,
    width: "100%",
  };

  const submit = async (e) => {
    e.preventDefault();
    setMsg("");
    setErr("");

    if (!emailRe.test(email)) {
      setErr("Correo inválido.");
      return;
    }

    try {
      setLoading(true);
      const { data } = await api.post("/auth/forgot", { email: email.trim() });
      setMsg(data?.message || "Si el correo existe en el sistema, se enviará una contraseña temporal.");
    } catch (er) {
      setErr(
        er.response?.data?.message ||
          "No se pudo procesar la recuperación de contraseña."
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={card}>
      <h2
        style={{
          marginTop: 0,
          textAlign: "center",
          fontSize: "clamp(20px, 3vw, 26px)",
        }}
      >
        Recuperar contraseña
      </h2>

      <p style={{ fontSize: 14, color: "#b6a726ff", marginBottom: 12 }}>
        Ingresa tu correo registrado. Si existe en el sistema, se enviará una
        contraseña temporal a tu bandeja de entrada.
      </p>

      {err && <div style={box("#b91c1c", "#fee2e2")}>{err}</div>}
      {msg && <div style={box("#14532d", "#bbf7d0")}>{msg}</div>}

      <form onSubmit={submit} style={{ display: "grid", gap: 12 }}>
        <label>
          Correo
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="usuario@dominio.com"
            required
            style={{ width: "100%" }}
            autoComplete="email"
          />
        </label>

        <button type="submit" style={btnPrimary} disabled={loading}>
          {loading ? "Enviando..." : "Enviar Contraseña Temporal"}
        </button>
      </form>

      <button
        type="button"
        style={btnSecondary}
        onClick={() => nav("/login")}
      >
        Regresar al Login
      </button>
    </div>
  );
}