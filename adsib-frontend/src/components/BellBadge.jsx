import { useEffect, useState } from "react";
import api from "../api";

export default function BellBadge({ onClick }) {
  const [count, setCount] = useState(0);

  async function fetchCount() {
    try {
      const { data } = await api.get("/notificaciones/count");
      setCount(Number(data?.unread || 0));
    } catch {}
  }

  useEffect(() => {
    fetchCount();
    const id = setInterval(fetchCount, 30_000); // refresco cada 30s
    return () => clearInterval(id);
  }, []);

  return (
    <button onClick={onClick} style={{
      position:"relative",
      border:"1px solid #1f2937",
      background:"#111827",
      padding:"8px 10px",
      borderRadius:8,
      color:"#e5e7eb",
      display:"inline-flex",
      alignItems:"center",
      gap:8
    }}>
      <span aria-hidden>🔔</span>
      {count > 0 && (
        <span style={{
          position:"absolute", top:-6, right:-6,
          background:"#dc2626", color:"#fff",
          borderRadius:999, padding:"2px 6px", fontSize:12, fontWeight:700
        }}>
          {count}
        </span>
      )}
      <span style={{fontSize:0, lineHeight:0}}>notifications</span>
    </button>
  );
}