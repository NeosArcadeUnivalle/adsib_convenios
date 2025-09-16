import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useState } from "react";
import api, { clearToken } from "../../api";
import "./AppShell.css";

export default function AppShell() {
  const nav = useNavigate();
  const { pathname } = useLocation();
  const [collapsed, setCollapsed] = useState(false);

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
            <span className="icon">📄</span>
            <span className="text">Convenios</span>
          </Link>

          <Link className={`nav-link ${pathname.startsWith("/usuarios") ? "active" : ""}`} to="/usuarios">
            <span className="icon">👤</span>
            <span className="text">Usuarios</span>
          </Link>

          <Link className={`nav-link ${pathname.startsWith("/notificaciones") ? "active" : ""}`} to="/notificaciones">
            <span className="icon">🔔</span>
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
    </div>
  );
}