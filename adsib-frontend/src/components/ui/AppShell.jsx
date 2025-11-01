import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useMemo, useState, useCallback } from "react";
import api, { clearToken } from "../../api";
import "./AppShell.css";

export default function AppShell() {
  const nav = useNavigate();
  const { pathname, search } = useLocation();
  const [collapsed, setCollapsed] = useState(false);

  // Popup (inline)
  const [showPopup, setShowPopup] = useState(false);
  const [counts, setCounts] = useState({
    notificaciones: 0,       // = high + medium (según /notificaciones/alertas)
    convenios_vencidos: 0,   // reservado para futuro
    riesgo_alto: 0,          // = high.length
    riesgo_medio: 0,         // = medium.length
  });

  // Permite forzar el popup manualmente con ?popup=1 (solo para pruebas)
  const forcePopup = useMemo(() => {
    const qs = new URLSearchParams(search);
    return qs.get("popup") === "1";
  }, [search]);

  /** Normaliza la respuesta de /notificaciones/alertas a {high[], medium[]} */
  const parseAlertas = useCallback((data) => {
    const high = Array.isArray(data?.high) ? data.high : (data?.altas || []);
    const medium = Array.isArray(data?.medium) ? data.medium : (data?.medias || []);
    return { high, medium };
  }, []);

  /** Carga contadores SIEMPRE desde /notificaciones/alertas (para que coincida con la vista) */
  const fetchCountsFromAlertas = useCallback(async () => {
    try {
      const { data } = await api.get("/notificaciones/alertas");
      const { high, medium } = parseAlertas(data);
      setCounts({
        notificaciones: (high?.length || 0) + (medium?.length || 0),
        convenios_vencidos: 0,
        riesgo_alto: high?.length || 0,
        riesgo_medio: medium?.length || 0,
      });
    } catch {
      // silencio: no romper la UI por errores intermitentes
    }
  }, [parseAlertas]);

  // Carga y refresca el overview/badges (ahora basado en alertas)
  useEffect(() => {
    let timer;
    fetchCountsFromAlertas();
    // refresco cada 30s (solo actualiza contadores)
    timer = setInterval(fetchCountsFromAlertas, 30000);
    return () => clearInterval(timer);
  }, [fetchCountsFromAlertas]);

  // Mostrar popup SOLO una vez: justo después del login y al aterrizar en "/"
  useEffect(() => {
    const onHome = pathname === "/";
    const justLogged = sessionStorage.getItem("just_logged_v2") === "1";

    const maybeShowOnce = async () => {
      await fetchCountsFromAlertas();   // usa mismas fuentes que la página
      setShowPopup(true);
      sessionStorage.removeItem("just_logged_v2"); // evitar repetición
    };

    // Modo pruebas ?popup=1: muestra siempre que estés en "/"
    if (forcePopup && onHome) {
      maybeShowOnce();
      return;
    }

    // Caso normal: solo cuando vienes del login y caes a "/"
    if (justLogged && onHome) {
      maybeShowOnce();
    }
  }, [pathname, forcePopup, fetchCountsFromAlertas]);

  const closePopup = () => setShowPopup(false);

  const goToNotifications = () => {
    closePopup();
    nav("/notificaciones");
  };

  const logout = async () => {
    try { await api.post("/auth/logout"); } catch {}
    clearToken();
    nav("/login");
  };

  // Chip redondo para los contadores
  const Pill = ({ num, label, tint }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <span
        style={{
          width: 28,
          height: 28,
          borderRadius: 999,
          background: tint,
          color: "#0b1220",
          fontWeight: 900,
          textAlign: "center",
          lineHeight: "28px",
          boxShadow: "0 0 0 2px rgba(255,255,255,0.06) inset",
        }}
      >
        {num}
      </span>
      <span style={{ fontSize: 16, fontWeight: 700 }}>{label}</span>
    </div>
  );

  return (
    <div className={`layout ${collapsed ? "is-collapsed" : ""}`}>
      <aside className="sidebar">
        <button
          className="brand"
          type="button"
          title="Mostrar/ocultar menú"
          onClick={() => setCollapsed((v) => !v)}
        >
          <img src="/adsib.jpg" alt="ADSIB" />
          {!collapsed && <span className="brand-text">ADSIB</span>}
        </button>

        <nav className="nav">
          <Link
            className={`nav-link ${pathname.startsWith("/asistente") ? "active" : ""}`}
            to="/asistente"
            title="Asistente Virtual"
          >
            <span className="icon" aria-hidden />
            <span className="text">Asistente Virtual</span>
          </Link>

          <Link
            className={`nav-link ${pathname === "/" ? "active" : ""}`}
            to="/"
            title="Convenios"
          >
            <span className="icon" aria-hidden />
            <span className="text">Convenios</span>
          </Link>

          <Link
            className={`nav-link ${pathname.startsWith("/usuarios") ? "active" : ""}`}
            to="/usuarios"
            title="Usuarios"
          >
            <span className="icon" aria-hidden />
            <span className="text">Usuarios</span>
          </Link>

          {/* Notificaciones + badge */}
          <Link
            className={`nav-link ${pathname.startsWith("/notificaciones") ? "active" : ""}`}
            to="/notificaciones"
            title="Notificaciones"
            style={{ position: "relative" }}
          >
            <span className="icon" aria-hidden />
            {!collapsed && <span className="text">Notificaciones</span>}
            {Number(counts.notificaciones) > 0 && (
              <span
                style={{
                  position: "absolute",
                  right: collapsed ? 6 : 10,
                  top: 6,
                  background: "#dc2626",
                  color: "#fff",
                  borderRadius: 999,
                  padding: "2px 6px",
                  fontSize: 12,
                  fontWeight: 700,
                  lineHeight: 1,
                  minWidth: 18,
                  textAlign: "center",
                }}
                aria-label={`${counts.notificaciones} notificaciones (ALTO+MEDIO)`}
              >
                {counts.notificaciones}
              </span>
            )}
          </Link>
        </nav>

        <button className="nav-link logout" type="button" onClick={logout}>
          <span className="icon">⎋</span>
          <span className="text">Salir</span>
        </button>
      </aside>

      <main className="content">
        <Outlet />
      </main>

      {/* ==================== POPUP ==================== */}
      {showPopup && (
        <>
          <style>{`
            @keyframes adsibPopIn {
              from { opacity: 0; transform: translateY(8px) scale(.98); }
              to   { opacity: 1; transform: translateY(0) scale(1); }
            }
          `}</style>

          <div
            role="dialog"
            aria-modal="true"
            onClick={closePopup}
            style={{
              position: "fixed",
              inset: 0,
              background:
                "linear-gradient(180deg, rgba(0, 0, 0, 0.65), rgba(0, 0, 0, 0.45))",
              backdropFilter: "blur(4px)",
              WebkitBackdropFilter: "blur(4px)",
              display: "grid",
              placeItems: "center",
              zIndex: 50,
              padding: 16,
            }}
          >
            <div
              className="card"
              onClick={(e) => e.stopPropagation()}
              style={{
                width: "min(560px, 96vw)",
                borderRadius: 18,
                overflow: "hidden",
                background:
                  "linear-gradient(180deg, #242424ff 0%, #1f1f1fff 100%)",
                border: "1px solid rgba(0, 0, 0, 0.15)",
                boxShadow:
                  "0 20px 40px rgba(0, 0, 0, 0.45), 0 0 0 1px rgba(0, 0, 0, 0.03) inset",
                color: "#e5e7eb",
                animation: "adsibPopIn .18s ease-out both",
              }}
            >
              <div
                style={{
                  padding: "16px 18px",
                  background:
                    "linear-gradient(90deg, rgba(0, 0, 0, 0.08), rgba(0, 0, 0, 0.08))",
                  borderBottom: "1px solid rgba(0, 0, 0, 0.12)",
                }}
              >
                <h2 style={{ margin: 0, letterSpacing: ".2px" }}>
                  Resumen rápido
                </h2>
              </div>

              <div style={{ padding: 18, display: "grid", gap: 14 }}>
                <Pill
                  num={Number(counts.riesgo_alto || 0)}
                  label="Convenios con riesgo ALTO"
                  tint="#ff6969ff"
                />
                <Pill
                  num={Number(counts.riesgo_medio || 0)}
                  label="Convenios con riesgo MEDIO (advertencia)"
                  tint="#fcdc5bff"
                />
              </div>

              <div
                style={{
                  padding: 16,
                  display: "flex",
                  gap: 10,
                  justifyContent: "flex-end",
                  borderTop: "1px solid rgba(148,163,184,.12)",
                }}
              >
                <button
                  className="btn"
                  style={{
                    background: "#1c84b1ff",
                    borderColor: "#026292ff",
                    color: "#fff",
                    fontWeight: 700,
                  }}
                  onClick={goToNotifications}
                >
                  Ir a notificaciones
                </button>
                <button
                  className="btn"
                  onClick={closePopup}
                  style={{ background: "#02a002ff", borderColor: "#005f0dff", color: "#fff" }}
                >
                  Entendido
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}