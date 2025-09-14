import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../../api";

export default function NotificationsBell() {
  const [res, setRes] = useState({ notificaciones_no_leidas: 0, convenios_vencidos: 0 });

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const { data } = await api.get("/dashboard/resumen");
        if (alive) setRes(data);
      } catch {}
    };
    load();
    const id = setInterval(load, 60000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const Badge = ({ n, bg }) => (
    <span className="pill" style={{ background: bg, marginLeft: 6 }}>{n}</span>
  );

  return (
    <Link to="/notificaciones" style={{ textDecoration:"none", color:"inherit", display:"flex", alignItems:"center" }}>
      <span title="Notificaciones">🔔</span>
      <Badge n={res.notificaciones_no_leidas} bg="#e0e7ff" />
      <span title="Vencidos" style={{ marginLeft: 10 }}>📅</span>
      <Badge n={res.convenios_vencidos} bg="#fecaca" />
    </Link>
  );
}