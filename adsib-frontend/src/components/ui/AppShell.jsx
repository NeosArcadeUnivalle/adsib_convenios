import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import api, { clearToken } from "../../api";
import DashboardPopup from "../DashboardPopup";
import "./AppShell.css";

export default function AppShell() {
  const nav = useNavigate();
  const { pathname, search } = useLocation();
  const [collapsed, setCollapsed] = useState(false);

  // Popup
  const [showPopup, setShowPopup] = useState(false);
  const [counts, setCounts] = useState({
    notificaciones: 0,
    convenios_vencidos: 0,
    riesgo_alto: 0,
    riesgo_medio: 0,
  });

  const forcePopup = useMemo(() => {
    const qs = new URLSearchParams(search);
    return qs.get("popup") === "1";
  }, [search]);

  useEffect(() => {
    const LS_KEY = "seen_dashboard_popup_v2";
    const justLogged = sessionStorage.getItem("just_logged_v2") === "1";

    api.get("/dashboard/overview")
      .then(({ data }) => {
        setCounts({
          notificaciones: Number(data?.notificaciones ?? 0),
          convenios_vencidos: Number(data?.convenios_vencidos ?? 0),
          riesgo_alto: Number(data?.riesgo_alto ?? 0),
          riesgo_medio: Number(data?.riesgo_medio ?? 0),
        });

        if (justLogged || forcePopup || !localStorage.getItem(LS_KEY)) {
          setShowPopup(true);
        }
      })
      .catch(() => {
        if (justLogged || forcePopup || !localStorage.getItem(LS_KEY)) {
          setShowPopup(true);
        }
      })
      .finally(() => {
        sessionStorage.removeItem("just_logged_v2");
      });
  }, [forcePopup]);

  const closePopup = () => {
    localStorage.setItem("seen_dashboard_popup_v2", "1");
    setShowPopup(false);
  };

  const logout = async () => {
    try { await api.post("/auth/logout"); } catch {}
    clearToken();
    nav("/login");
  };

  return (
    <div className={`layout ${collapsed ? "is-collapsed" : ""}`}>
      <aside className="sidebar">
        <button
          className="brand"
          type="button"
          title="Mostrar/ocultar menú"
          onClick={() => setCollapsed(v => !v)}
        >
          <img src="/adsib.jpg" alt="ADSIB" />
          {!collapsed && <span className="brand-text">ADSIB</span>}
        </button>

        <nav className="nav">
          <Link className={`nav-link ${pathname === "/" ? "active" : ""}`} to="/">
            <span className="text">Convenios</span>
          </Link>
          <Link className={`nav-link ${pathname.startsWith("/usuarios") ? "active" : ""}`} to="/usuarios">
            <span className="text">Usuarios</span>
          </Link>
          <Link className={`nav-link ${pathname.startsWith("/notificaciones") ? "active" : ""}`} to="/notificaciones">
            <span className="text">Notificaciones</span>
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

      {/* Popup de resumen */}
      <DashboardPopup open={showPopup} onClose={closePopup} counts={counts} />
    </div>
  );
}