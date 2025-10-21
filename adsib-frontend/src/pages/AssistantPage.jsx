import React, { useEffect, useMemo, useRef, useState } from "react";
import api from "../api";

/* ============ UI helpers mínimos (sin Tailwind) ============ */
const Avatar = ({ role }) => (
  <div
    style={{
      height: 36,
      width: 36,
      borderRadius: 999,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: 12,
      fontWeight: 700,
      color: "#fff",
      boxShadow: "0 6px 18px rgba(0,0,0,.25)",
      background: role === "user" ? "#0d9488" : "#f97316",
      userSelect: "none",
      flex: "0 0 auto",
    }}
  >
    {role === "user" ? "Tú" : "AI"}
  </div>
);

const Bubble = ({ role, text }) => {
  const isUser = role === "user";
  return (
    <div
      style={{
        display: "flex",
        gap: 12,
        justifyContent: isUser ? "flex-end" : "flex-start",
        alignItems: "flex-start",
      }}
    >
      {!isUser && <Avatar role={role} />}
      <div
        style={{
          maxWidth: "75%",
          whiteSpace: "pre-wrap",
          borderRadius: 18,
          padding: "10px 14px",
          lineHeight: 1.5,
          color: isUser ? "#e6fffb" : "#f4f4f5",
          background: isUser ? "#0f766e" : "#0a0a0a", // negro para asistente
          boxShadow:
            "0 4px 16px rgba(0,0,0,.25), inset 0 0 0 1px rgba(255,255,255,.07)",
        }}
      >
        {text}
      </div>
      {isUser && <Avatar role={role} />}
    </div>
  );
};

const TypingDots = () => (
  <div style={{ display: "flex", gap: 6, alignItems: "center", color: "#9ca3af" }}>
    <span className="dot" />
    <span className="dot" style={{ animationDelay: ".12s" }} />
    <span className="dot" style={{ animationDelay: ".24s" }} />
  </div>
);

/* =================== Página =================== */
export default function AssistantPage() {
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      text:
        "¡Hola! Soy tu asistente de convenios. Pregúntame cualquier cosa sobre vencimientos, riesgos, versiones, comparaciones o historial.",
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  const scroller = useRef(null);
  const textareaRef = useRef(null);

  const canSend = useMemo(() => input.trim().length > 0 && !busy, [input, busy]);

  // autoscroll
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  // autosize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "0px";
    ta.style.height = Math.min(180, ta.scrollHeight) + "px";
  }, [input]);

  const send = async (text) => {
    const msg = (text ?? input).trim();
    if (!msg || busy) return;

    setMessages((m) => [...m, { role: "user", text: msg }]);
    setInput("");
    setBusy(true);

    try {
      const { data } = await api.post(
        "/assistant/chat",
        { message: msg, context: {} },
        { timeout: 120000 }
      );
      const reply = data?.reply || "No recibí respuesta.";
      setMessages((m) => [...m, { role: "assistant", text: reply }]);
    } catch (e) {
      console.error(e);
      setMessages((m) => [
        ...m,
        { role: "assistant", text: "Ocurrió un problema al consultar. Inténtalo nuevamente." },
      ]);
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey && canSend) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div style={styles.page}>
      <style>{css}</style>

      {/* Header */}
      <header style={styles.header}>
        <div style={styles.headerInner}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={styles.brandCube} />
            <h1 style={styles.title}>Asistente Virtual</h1>
          </div>
        </div>
      </header>

      {/* Card contenedor */}
      <main style={styles.main}>
        <div style={styles.card}>
          <div style={styles.cardTopBar} />

          {/* Chat area */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: "18px 22px" }}>
            <div ref={scroller} style={styles.scrollArea}>
              <div style={{ display: "flex", flexDirection: "column", gap: 12, margin: "0 auto", maxWidth: 880 }}>
                {messages.map((m, i) => (
                  <Bubble key={i} role={m.role} text={m.text} />
                ))}

                {busy && (
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <Avatar role="assistant" />
                    <div style={styles.typingBubble}>
                      <TypingDots />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Composer */}
            <div style={styles.composerRow}>
              <div style={{ flex: 1 }}>
                <label htmlFor="prompt" style={styles.srOnly}>
                  Escribe tu pregunta
                </label>
                <textarea
                  id="prompt"
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={onKeyDown}
                  rows={1}
                  placeholder="Escribe tu pregunta… (Shift+Enter para salto de línea)"
                  style={styles.textarea}
                />
              </div>
              <button
                onClick={() => send()}
                disabled={!canSend}
                style={{ ...styles.sendBtn, ...(canSend ? {} : styles.sendBtnDisabled) }}
                title="Enviar (Enter)"
              >
                Enviar
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

/* =================== Estilos (sin frameworks) =================== */
const styles = {
  page: {
    minHeight: "100vh",
    background: "#000000ff",
    color: "#e5e7eb",
  },
  header: {
    position: "sticky",
    top: 0,
    zIndex: 10,
    borderBottom: "1px solid #000000ff",
    border: "2px solid #000000ff",
    background: "rgba(29, 29, 29, 0.85)",
    backdropFilter: "blur(6px)",
  },
  headerInner: {
    maxWidth: 1200,
    margin: "0 auto",
    padding: "14px 16px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  brandCube: {
    width: 40,
    height: 40,
    borderRadius: 12,
    background:
      "linear-gradient(135deg, rgba(249,115,22,1) 0%, rgba(245,158,11,1) 50%, rgba(13,148,136,1) 100%)",
    boxShadow: "0 8px 24px rgba(0,0,0,.35)",
  },
  title: {
    margin: 0,
    fontSize: 26,
    fontWeight: 900,
    letterSpacing: ".2px",
  },
  main: {
    maxWidth: 1200,
    margin: "0 auto",
    padding: "24px 16px",
  },
  card: {
    maxWidth: 980,
    margin: "0 auto",
    borderRadius: 22,
    border: "1px solid #000000ff",
    background:
      "linear-gradient(180deg, rgba(39, 39, 39, 1) 0%, rgba(32, 32, 32, 0.94) 100%)",
    boxShadow: "0 24px 60px rgba(0,0,0,.35)",
    overflow: "hidden",
  },
  cardTopBar: {
    height: 6,
    width: "100%",
    background: "linear-gradient(90deg, #f97316, #f59e0b, #10b981)",
  },
  scrollArea: {
    height: "60vh",
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,.06)",
    background: "rgba(0,0,0,.35)", // más oscuro para integrarse con burbuja negra
    overflowY: "auto",
    padding: 14,
  },
  typingBubble: {
    borderRadius: 16,
    padding: "10px 14px",
    background: "#242424ff",
    border: "1px solid rgba(0, 0, 0, 0.07)",
  },
  composerRow: {
    display: "flex",
    alignItems: "flex-end",
    gap: 10,
    maxWidth: 880,
    margin: "0 auto",
    width: "100%",
  },
  textarea: {
    width: "100%",
    resize: "none",
    borderRadius: 16,
    padding: "10px 12px",
    lineHeight: 1.6,
    color: "#e5e7eb",
    background: "rgba(0, 0, 0, 0.6)",
    border: "1px solid #0a0a0aff",
    outline: "none",
    boxShadow: "inset 0 0 0 1px rgba(255,255,255,.04)",
    transition: "border-color .15s, box-shadow .15s",
  },
  sendBtn: {
    border: "none",
    cursor: "pointer",
    padding: "10px 16px",
    borderRadius: 16,
    fontWeight: 700,
    color: "#0b1220",
    background: "linear-gradient(135deg,#f97316,#f59e0b)",
    boxShadow: "0 10px 24px rgba(249,115,22,.25)",
    transition: "transform .06s ease, opacity .15s",
  },
  sendBtnDisabled: {
    cursor: "not-allowed",
    opacity: 0.55,
    boxShadow: "none",
  },
  srOnly: {
    position: "absolute",
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: "hidden",
    clip: "rect(0,0,0,0)",
    whiteSpace: "nowrap",
    border: 0,
  },
};

/* mini CSS para puntos de “escribiendo…” */
const css = `
  .dot{
    width:8px;height:8px;border-radius:999px;background:#9ca3af;
    display:inline-block;animation:bounce 1s infinite ease-in-out;
  }
  @keyframes bounce{
    0%,80%,100%{transform:translateY(0);opacity:.6}
    40%{transform:translateY(-6px);opacity:1}
  }
`;