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
          background: isUser ? "#0f766e" : "#0a0a0a",
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

  // NUEVO: guía plegable
  const [showGuide, setShowGuide] = useState(true);

  const scroller = useRef(null);
  const textareaRef = useRef(null);

  const canSend = useMemo(() => input.trim().length > 0 && !busy, [input, busy]);

  // autoscroll
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, busy, showGuide]);

  // autosize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "0px";
    ta.style.height = Math.min(180, ta.scrollHeight) + "px";
  }, [input]);

  const parseLaravelError = (err) => {
    // intenta extraer información útil del backend
    const data = err?.response?.data;
    if (!data) return null;

    // Si tu backend retorna {reply, meta}, muéstralo
    if (typeof data.reply === "string" && data.reply.trim()) {
      return data.reply;
    }

    // Modo debug de Laravel: { message, exception, file, line, trace ... }
    const parts = [];
    if (data.message) parts.push(`Mensaje: ${data.message}`);
    if (data.exception) parts.push(`Excepción: ${data.exception}`);
    if (data.file && data.line) parts.push(`Ubicación: ${data.file}:${data.line}`);
    return parts.length ? `⚠️ Error del servidor (500)\n\n${parts.join("\n")}` : null;
  };

  const send = async (text) => {
    const msg = (text ?? input).trim();
    if (!msg || busy) return;

    setMessages((m) => [...m, { role: "user", text: msg }]);
    setInput("");
    setBusy(true);

    try {
      const { data } = await api.post(
        "/assistant/chat", // baseURL del axios "api" debería ser "/api"
        { message: msg, context: {} },
        {
          timeout: 120000,
          headers: {
            "Accept": "application/json",
            "X-Requested-With": "XMLHttpRequest",
          },
        }
      );

      const reply = data?.reply || "No recibí respuesta.";
      setMessages((m) => [...m, { role: "assistant", text: reply }]);
    } catch (e) {
      console.error(e);
      const friendly = parseLaravelError(e) ||
        "Ocurrió un problema al consultar (HTTP 500). Revisa el log en el servidor: storage/logs/laravel.log";
      setMessages((m) => [...m, { role: "assistant", text: friendly }]);
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

          {/* NUEVO: botón guía en header */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              onClick={() => setShowGuide((v) => !v)}
              style={{
                ...styles.helpBtn,
                ...(showGuide ? styles.helpBtnActive : {}),
              }}
              title={showGuide ? "Ocultar guía" : "Mostrar guía"}
            >
              {showGuide ? "Ocultar guía" : "Guía"}
            </button>
          </div>
        </div>
      </header>

      {/* Card contenedor */}
      <main style={styles.main}>
        <div style={styles.card}>
          <div style={styles.cardTopBar} />

          {/* NUEVO: Panel de Guía */}
          {showGuide && (
            <div style={styles.guide}>
              <div style={styles.guideCols}>
                <section style={styles.guideCol}>
                  <h3 style={styles.guideTitle}>Cómo usar el asistente</h3>
                  <ul style={styles.guideList}>
                    <li>
                      <strong style={styles.strong}>Pregunta directo</strong> con lenguaje natural.
                      No necesitas el nombre exacto ni el formato “oficial”. El asistente entiende abreviaturas,
                      errores comunes y alias (p. ej., <em>BoA</em>, <em>AGETIC</em>, <em>Ministerio salud dep</em>).
                    </li>
                    <li>
                      Para referirte a una <strong style={styles.strong}>versión</strong> puedes decir
                      “v1”, “versión 2”, “archivo inicial/final”.
                    </li>
                    <li>
                      Si quieres <strong style={styles.strong}>filtrar por tiempo</strong> usa frases como
                      “este año”, “próximos 30 días”, “ordenados por vencimiento”.
                    </li>
                    <li>
                      El asistente solo responde sobre <strong style={styles.strong}>convenios</strong>
                      (fechas, versiones, riesgo, cláusulas, contacto, notificaciones, etc.). Preguntas fuera de este
                      tema mostrarán un mensaje estándar.
                    </li>
                  </ul>
                </section>

                <section style={styles.guideCol}>
                  <h3 style={styles.guideTitle}>Ejemplos útiles</h3>
                  <ul style={styles.guideList}>
                    <li>¿Cuál es la <strong style={styles.strong}>fecha de vencimiento</strong> del convenio con <em>BoA</em>?</li>
                    <li>¿Qué convenios <strong style={styles.strong}>vencen este año</strong>?</li>
                    <li>Muéstrame los convenios <strong style={styles.strong}>firmados este año</strong>.</li>
                    <li>Convenios <strong style={styles.strong}>ordenados por vencimiento</strong>.</li>
                    <li>¿Qué convenios están en estado <strong style={styles.strong}>NEGOCIACION</strong>?</li>
                    <li>¿Qué convenios vencen en los <strong style={styles.strong}>próximos 15 días</strong>?</li>
                    <li>¿Cuántas <strong style={styles.strong}>versiones</strong> tiene mi convenio con <em>Ministerio de Salud</em>?</li>
                    <li>¿Cuáles son las <strong style={styles.strong}>observaciones</strong> de la <strong style={styles.strong}>v1</strong> de <em>AGETIC</em>?</li>
                    <li>Dime las <strong style={styles.strong}>cláusulas detectadas</strong> en el último <strong style={styles.strong}>análisis de riesgo</strong> de <em>BoA</em>.</li>
                    <li>Quiero los <strong style={styles.strong}>detalles</strong> del convenio <em>UMSS</em>.</li>
                    <li>¿Cuál es la <strong style={styles.strong}>descripción</strong> de mi convenio <em>UPB</em>?</li>
                    <li>¿Quién es el <strong style={styles.strong}>contacto/responsable</strong> de <em>AGETIC</em>?</li>
                    <li>¿Cuáles son mis <strong style={styles.strong}>notificaciones</strong> más recientes?</li>
                  </ul>
                </section>
              </div>
              <div style={styles.tipRow}>
                <span style={styles.tipBadge}>Sugerencia</span>
                <span>
                  Si el nombre es largo, puedes escribirlo entre comillas:{" "}
                  <code style={styles.code}>"Ministerio de Salud y Deportes"</code>.  
                  También puedes usar abreviaturas: <code style={styles.code}>MSD</code>,{" "}
                  <code style={styles.code}>AGETIC</code>, <code style={styles.code}>BoA</code>.
                </span>
              </div>
            </div>
          )}

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

  /* ===== NUEVO: Guía ===== */
  guide: {
    padding: "16px 22px 6px",
    borderBottom: "1px solid rgba(255,255,255,.06)",
    background: "rgba(0,0,0,.35)",
  },
  guideCols: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 18,
  },
  guideCol: {
    background: "rgba(20,20,20,.55)",
    border: "1px solid rgba(255,255,255,.06)",
    borderRadius: 14,
    padding: "14px 16px",
  },
  guideTitle: {
    margin: "0 0 8px 0",
    fontSize: 16,
    fontWeight: 800,
    color: "#f3f4f6",
  },
  guideList: {
    margin: 0,
    paddingLeft: 18,
    lineHeight: 1.6,
    color: "#d1d5db",
  },
  tipRow: {
    display: "flex",
    gap: 10,
    alignItems: "center",
    padding: "10px 12px",
    marginTop: 12,
    background: "rgba(24,24,24,.55)",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,.06)",
    color: "#d1d5db",
  },
  tipBadge: {
    display: "inline-block",
    padding: "4px 8px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 800,
    color: "#0b1220",
    background: "linear-gradient(135deg,#f97316,#f59e0b)",
  },
  code: {
    background: "rgba(0,0,0,.45)",
    border: "1px solid rgba(255,255,255,.06)",
    padding: "2px 6px",
    borderRadius: 8,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 12,
    color: "#e5e7eb",
  },
  strong: {
    fontWeight: 800,
    color: "#f9fafb",
  },

  scrollArea: {
    height: "60vh",
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,.06)",
    background: "rgba(0,0,0,.35)",
    overflowY: "auto",
    padding: 14,
  },
  typingBubble: {
    borderRadius: 16,
    padding: "10px 14px",
    background: "#242424ff",
    border: "1px solid rgba(0, 0, 0, 0.07)",
  },
  // Reemplaza en "styles"
  composerRow: {
    display: "flex",
    alignItems: "center",      // <- antes: "flex-end"
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
    minHeight: 44,             // <- asegura altura mínima
    lineHeight: 1.4,
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
    height: 45,                // <- igual a la altura del textarea
    padding: "0 16px",         // <- vertical 0 para centrar
    display: "inline-flex",    // <- centra contenido
    alignItems: "center",
    justifyContent: "center",
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
  helpBtn: {
    border: "1px solid rgba(255,255,255,.12)",
    background: "rgba(0,0,0,.35)",
    color: "#e5e7eb",
    padding: "8px 12px",
    borderRadius: 12,
    fontWeight: 700,
    cursor: "pointer",
    boxShadow: "0 6px 18px rgba(0,0,0,.25)",
    transition: "opacity .15s, transform .06s",
  },
  helpBtnActive: {
    background: "linear-gradient(135deg,#f97316,#f59e0b)",
    color: "#0b1220",
    border: "1px solid rgba(0,0,0,.25)",
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