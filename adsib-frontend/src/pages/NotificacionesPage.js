import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api";

/* --------- UI helpers --------- */
const chip = (text, type = "neutral") => {
  const styles =
    {
      high: { bg: "#991b1b", fg: "#fff" },   // rojo
      medium: { bg: "#92400e", fg: "#fff" }, // ámbar
      neutral: { bg: "#111827", fg: "#e5e7eb" },
    }[type] || { bg: "#111827", fg: "#e5e7eb" };

  return (
    <span
      style={{
        background: styles.bg,
        color: styles.fg,
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 700,
      }}
    >
      {text}
    </span>
  );
};

/** Texto explicativo según los motivos y estado */
const detalleAlto = (n) => {
  const m = n.motivos || [];
  const venc = m.includes("vencimiento");
  const anal = m.includes("analisis");
  if (venc && anal) {
    return n.estado === "VENCIDO"
      ? "Vencido y riesgo ALTO (último análisis)"
      : "Vencimiento en ≤ 30 días y riesgo ALTO (último análisis)";
  }
  if (anal) return "Detectado por análisis de riesgo";
  return n.estado === "VENCIDO" ? "Convenio vencido." : "Vencimiento en ≤ 30 días";
};

const detalleMedio = (n) => {
  const m = n.motivos || [];
  if (m.includes("analisis")) return "Detectado por análisis de riesgo";
  return "Vencimiento en 31–90 días";
};

export default function NotificacionesPage() {
  const [high, setHigh] = useState([]);
  const [medium, setMedium] = useState([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const pollRef = useRef(null);

  const load = useCallback(async () => {
    setErr("");
    try {
      const resp = await api.get("/notificaciones/alertas");
      const data = resp?.data || {};
      setHigh(Array.isArray(data.high) ? data.high : (data.altas || []));
      setMedium(Array.isArray(data.medium) ? data.medium : (data.medias || []));
    } catch {
      setErr("No se pudieron obtener las notificaciones.");
    }
  }, []);

  // carga inicial + polling "tiempo real"
  useEffect(() => {
    (async () => {
      setLoading(true);
      await load();
      setLoading(false);
    })();

    // polling cada 10s
    pollRef.current = setInterval(() => { load(); }, 10000);

    // refrescar al volver a la pestaña
    const onVisible = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  const filterList = useCallback((list, query) => {
    const s = (query || "").trim().toLowerCase();
    if (!s) return list;
    return list.filter(
      (n) =>
        (n.mensaje || "").toLowerCase().includes(s) ||
        (n.convenio_titulo || "").toLowerCase().includes(s)
    );
  }, []);

  const hi = useMemo(() => filterList(high, q), [high, q, filterList]);
  const mid = useMemo(() => filterList(medium, q), [medium, q, filterList]);

  const BtnVer = ({ id }) => (
    <Link
      className="btn"
      to={`/convenios/${id}`}
      style={{
        background: "#249ccfff",
        borderColor: "#0274adff",
        color: "#fff",
        fontWeight: 700,
        textAlign: "center",
        minWidth: 108,
      }}
    >
      Ver
    </Link>
  );

  const formatoSoloFecha = (s) =>
    new Intl.DateTimeFormat("es-BO", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone: "America/La_Paz",
    }).format(new Date(s));

  return (
    <div className="card" style={{ padding: 20 }}>
      <h2 style={{ marginTop: 0 }}>Notificaciones</h2>

      <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
        <input
          placeholder="Buscar notificación…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ minWidth: 280 }}
        />
        <button className="btn" onClick={load} disabled={loading}>
          {loading ? "Actualizando…" : "Actualizar"}
        </button>
        {/* Se quita "Marcar todas como leídas" (ya no aplica) */}
      </div>

      {err && (
        <div className="card" style={{ background: "#7f1d1d", borderColor: "#b91c1c", color: "#fee2e2" }}>
          {err}
        </div>
      )}

      {/* ALTO */}
      <div className="card" style={{ borderColor: "#7f1d1d", marginTop: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <h3 style={{ margin: 0 }}>Prioritarias (ALTO)</h3>
          {chip(hi.length, "high")}
        </div>

        {hi.length === 0 ? (
          <div style={{ opacity: 0.8, marginTop: 6 }}>Sin notificaciones prioritarias.</div>
        ) : (
          <div style={{ marginTop: 8 }}>
            {hi.map((n) => (
              <div
                key={`${n.convenio_id}-${n.id ?? "s"}`}
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(240px,1fr) 120px 260px 160px 160px",
                  gap: 12,
                  alignItems: "center",
                  padding: "8px 0",
                  borderTop: "1px solid rgba(255,255,255,.05)",
                }}
              >
                <div style={{ fontWeight: 600 }}>
                  {n.convenio_titulo || `Convenio #${n.convenio_id}`}
                </div>
                <div>{chip("ALTO", "high")}</div>
                <div style={{ opacity: 0.9 }}>{detalleAlto(n)}</div>
                <div style={{ opacity: 0.8 }}>
                  {formatoSoloFecha(n.fecha_envio || n.created_at)}
                </div>
                <div style={{ display: "flex", justifyContent: "flex-start" }}>
                  <BtnVer id={n.convenio_id} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* MEDIO */}
      <div className="card" style={{ marginTop: 12, borderColor: "#78350f" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <h3 style={{ margin: 0 }}>Advertencias (MEDIO)</h3>
          {chip(mid.length, "medium")}
        </div>

        {mid.length === 0 ? (
          <div style={{ opacity: 0.8, marginTop: 6 }}>Sin advertencias.</div>
        ) : (
          <div style={{ marginTop: 8 }}>
            {mid.map((n) => (
              <div
                key={`${n.convenio_id}-${n.id ?? "s"}`}
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(240px,1fr) 120px 260px 160px 160px",
                  gap: 12,
                  alignItems: "center",
                  padding: "8px 0",
                  borderTop: "1px solid rgba(255,255,255,.05)",
                }}
              >
                <div style={{ fontWeight: 600 }}>
                  {n.convenio_titulo || `Convenio #${n.convenio_id}`}
                </div>
                <div>{chip("MEDIO", "medium")}</div>
                <div style={{ opacity: 0.9 }}>{detalleMedio(n)}</div>
                <div style={{ opacity: 0.8 }}>
                  {formatoSoloFecha(n.fecha_envio || n.created_at)}
                </div>
                <div style={{ display: "flex", justifyContent: "flex-start" }}>
                  <BtnVer id={n.convenio_id} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}