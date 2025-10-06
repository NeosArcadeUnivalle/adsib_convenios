// src/components/DashboardPopup.jsx
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

export default function DashboardPopup({ open, onClose, counts }) {
  const nav = useNavigate();
  const c = {
    noti: Number(counts?.notificaciones ?? 0),
    venc: Number(counts?.convenios_vencidos ?? 0),
    alto: Number(counts?.riesgo_alto ?? 0),
    medio: Number(counts?.riesgo_medio ?? 0),
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && onClose?.();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  // ====== PALETA coherente con la app ======
  const COLORS = {
    surface: "#1d1d1dff",          // fondo del modal (azul oscuro)
    border:  "#000000ff",          // borde tenue
    overlay: "rgba(0,0,0,.55)",  // fondo difuminado
    text:    "#e5e7eb",          // texto principal claro

    // acentos (coinciden con botones del sistema)
    primary: "#1a6779",          // teal oscuro (botón principal del sistema)
    primaryHover: "#0d839b",
    info:    "#0ea5e9",          // azul info
    warn:    "#f59e0b",          // ámbar
    danger:  "#ef4444",          // rojo
    mute:    "#94a3b8",          // gris azulado para secundarios
  };

  const box = {
    position: "fixed",
    inset: 0,
    zIndex: 1000,
  };
  const overlay = {
    position: "absolute",
    inset: 0,
    background: COLORS.overlay,
  };
  const panel = {
    position: "relative",
    maxWidth: 720,
    margin: "8vh auto",
    background: COLORS.surface,
    border: `1px solid ${COLORS.border}`,
    borderRadius: 14,
    color: COLORS.text,
    boxShadow: "0 10px 40px rgba(0,0,0,.45)",
  };
  const header = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "18px 20px 4px",
  };
  const title = { margin: 0, fontSize: 28, fontWeight: 800 };
  const closeBtn = {
    background: "#e90000ff",
    border: `1px solid ${COLORS.border}`,
    color: COLORS.text,
    borderRadius: 10,
    padding: "10px 14px",
    cursor: "pointer",
  };
  const content = { padding: "8px 20px 18px" };

  const row = (dotColor, label, value, subtle = false) => (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 6px",
      }}
    >
      <span
        aria-hidden
        style={{
          minWidth: 34,
          height: 34,
          borderRadius: "999px",
          background: dotColor,
          color: "#0b1220",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: 800,
          border: "2px solid rgba(255,255,255,.06)",
        }}
      >
        {value}
      </span>
      <span
        style={{
          fontSize: 18,
          color: subtle ? COLORS.mute : COLORS.text,
          fontWeight: subtle ? 500 : 600,
        }}
      >
        {label}
      </span>
    </div>
  );

  const btn = (bg, bgHover) => ({
    background: bg,
    border: "1px solid rgba(255,255,255,.12)",
    color: "#fff",
    borderRadius: 10,
    padding: "12px 18px",
    fontWeight: 700,
    cursor: "pointer",
    transition: "background .15s ease",
  });

  return (
    <div style={box} aria-modal="true" role="dialog">
      <div style={overlay} onClick={onClose} />
      <div style={panel}>
        <div style={header}>
          <h3 style={title}>Resumen rápido</h3>
          <button style={closeBtn} onClick={onClose}>Cerrar</button>
        </div>

        <div style={content}>
          <p style={{ margin: "6px 0 12px", color: COLORS.mute }}>
            Te mostramos los datos principales al ingresar.
          </p>

          {/* Líneas con contador */}
          {row(COLORS.warn,   "Notificaciones sin leer", c.noti)}
          {row(COLORS.danger, "Convenios vencidos",      c.venc)}
          {row(COLORS.danger, "Convenios con riesgo ALTO",  c.alto)}
          {row(COLORS.info,   "Convenios con riesgo MEDIO (advertencia)", c.medio, true)}

          {/* Acciones */}
          <div
            style={{
              display: "flex",
              gap: 10,
              paddingTop: 8,
              flexWrap: "wrap",
            }}
          >
            <button
              style={btn(COLORS.primary, COLORS.primaryHover)}
              onMouseEnter={(e) => (e.currentTarget.style.background = COLORS.primaryHover)}
              onMouseLeave={(e) => (e.currentTarget.style.background = COLORS.primary)}
              onClick={() => nav("/notificaciones")}
            >
              Ir a notificaciones
            </button>

            <button
              style={btn(COLORS.info, "#38bdf8")}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#38bdf8")}
              onMouseLeave={(e) => (e.currentTarget.style.background = COLORS.info)}
              onClick={() => nav("/")}
            >
              Ir a convenios
            </button>

            <button
              style={{
                ...btn("#122335", "#1b2e46"),
                color: COLORS.text,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#1b2e46")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "#122335")}
              onClick={onClose}
            >
              Entendido
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}