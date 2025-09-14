import { Link, Outlet, useNavigate } from "react-router-dom";
import NotificationsBell from "./NotificationsBell";
import { clearToken } from "../../api";

export default function AppShell() {
  const nav = useNavigate();
  const logout = () => { try { /* opcional: await api.post('/auth/logout') */ } finally { clearToken(); nav("/login"); } };

  return (
    <div>
      <header style={{
        display:"flex", justifyContent:"space-between", alignItems:"center",
        padding:"10px 16px", borderBottom:"1px solid #eee", position:"sticky", top:0, background:"#fff", zIndex:10
      }}>
        <div style={{display:"flex", alignItems:"center", gap:12}}>
          <Link to="/" style={{ textDecoration:"none", fontWeight:700 }}>📁 Convenios</Link>
          <Link to="/convenios/nuevo">+ Nuevo</Link>
        </div>
        <div style={{display:"flex", alignItems:"center", gap:16}}>
          <NotificationsBell />
          <button onClick={logout}>Salir</button>
        </div>
      </header>

      <main>
        <Outlet />
      </main>
    </div>
  );
}