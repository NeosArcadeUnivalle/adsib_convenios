import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import api, { clearToken } from "../api";

/* ==== helpers ==== */
const isoToday = () => {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
};
const isoPlusDays = (n) => {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
const daysLeft = (dateStr) => {
  if (!dateStr) return null;
  const end = new Date(dateStr);
  const t = new Date(); t.setHours(0, 0, 0, 0);
  return Math.floor((end - t) / (1000 * 60 * 60 * 24));
};
const BadgeVence = ({ date }) => {
  const d = daysLeft(date);
  if (d === null) return <span>—</span>;
  let bg = "#e5e7eb", txt = `${d}d`;
  if (d < 0) { bg = "#fecaca"; txt = `Vencido ${Math.abs(d)}d`; }
  else if (d === 0) bg = "#fde68a";
  else if (d <= 30) bg = "#fde68a";
  else if (d <= 60) bg = "#fef3c7";
  else bg = "#dcfce7";
  return <span style={{ padding: "2px 6px", borderRadius: 6, background: bg }}>{txt}</span>;
};

const ESTADOS = ["BORRADOR","NEGOCIACION","VIGENTE","SUSPENDIDO","VENCIDO","RESCINDIDO","CERRADO"];

export default function ConveniosList() {
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ last_page: 1 });
  const [f, setF] = useState({
    q: "",
    estado: "",
    fi_from: "",
    fi_to: "",
    fv_from: "",
    fv_to: "",
    prox30: false,
    sort: "fecha_vencimiento",
    dir: "asc",
    page: 1,
    per_page: 10,
  });

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (f.q) p.set("q", f.q);
    if (f.estado) p.set("estado", f.estado);
    if (f.fi_from) p.set("fi_from", f.fi_from);
    if (f.fi_to) p.set("fi_to", f.fi_to);
    if (f.fv_from) p.set("fv_from", f.fv_from);
    if (f.fv_to) p.set("fv_to", f.fv_to);
    p.set("sort", f.sort);
    p.set("dir", f.dir);
    p.set("page", f.page);
    p.set("per_page", f.per_page);
    return p.toString();
  }, [f]);

  useEffect(() => {
    let active = true;
    api.get(`/convenios?${qs}`).then((r) => {
      if (!active) return;
      setRows(r.data.data || []);
      setMeta({ last_page: r.data.last_page || 1 });
    }).catch((e)=>console.error(e.response?.data || e.message));
    return () => { active = false; };
  }, [qs]);

  const toggleProx30 = () => {
    setF((s) => {
      const prox30 = !s.prox30;
      if (prox30) {
        return { ...s, prox30, fv_from: isoToday(), fv_to: isoPlusDays(30), page: 1 };
      }
      return { ...s, prox30, fv_from: "", fv_to: "", page: 1 };
    });
  };

  const limpiarFiltros = () =>
    setF((s) => ({
      ...s, q: "", estado: "", fi_from: "", fi_to: "", fv_from: "", fv_to: "",
      prox30: false, page: 1, sort: "fecha_vencimiento", dir: "asc", per_page: 10,
    }));

  const logout = async () => {
    try { await api.post("/auth/logout"); } catch {}
    clearToken(); window.location.href = "/login";
  };

  const eliminar = async (id) => {
    if (!window.confirm("¿Eliminar este convenio? Esta acción no se puede deshacer.")) return;
    try {
      await api.delete(`/convenios/${id}`);
      setRows((x) => x.filter((r) => r.id !== id));
    } catch (e) {
      alert(e.response?.data?.message || "No se pudo eliminar.");
    }
  };

  return (
    <div style={{ padding: 16 }}>
      <h2 style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        Convenios
        <div style={{ display: "flex", gap: 8 }}>
          <Link to="/convenios/nuevo"><button>+ Nuevo</button></Link>
          <button onClick={logout}>Salir</button>
        </div>
      </h2>

      {/* Filtros */}
      <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(6,1fr)", margin: "8px 0 12px" }}>
        <input
          placeholder="Buscar por título o descripción..."
          value={f.q}
          onChange={(e) => setF((s) => ({ ...s, q: e.target.value, page: 1 }))}
          style={{ gridColumn: "span 2" }}
        />

        <select value={f.estado} onChange={(e)=>setF(s=>({...s, estado: e.target.value, page:1}))}>
          <option value="">Todos los estados</option>
          {ESTADOS.map((e)=> <option key={e} value={e}>{e}</option>)}
        </select>

        <select value={f.sort} onChange={(e) => setF((s) => ({ ...s, sort: e.target.value }))}>
          <option value="fecha_vencimiento">Ordenar por Vencimiento</option>
          <option value="fecha_firma">Ordenar por Firma</option>
          <option value="titulo">Ordenar por Título</option>
          <option value="updated_at">Ordenar por Actualizado</option>
        </select>

        <select value={f.dir} onChange={(e) => setF((s) => ({ ...s, dir: e.target.value }))}>
          <option value="asc">Asc</option>
          <option value="desc">Desc</option>
        </select>

        <input
          type="number" min={1} max={100} value={f.per_page}
          onChange={(e) => setF((s) => ({ ...s, per_page: +e.target.value || 10, page: 1 }))}
        />

        <div>Firma de: <input type="date" value={f.fi_from} onChange={(e) => setF((s) => ({ ...s, fi_from: e.target.value, page: 1 }))} /></div>
        <div>Firma a:   <input type="date" value={f.fi_to}   onChange={(e) => setF((s) => ({ ...s, fi_to: e.target.value, page: 1 }))} /></div>
        <div>Vence de:  <input type="date" value={f.fv_from} onChange={(e) => setF((s) => ({ ...s, fv_from: e.target.value, prox30:false, page: 1 }))} /></div>
        <div>Vence a:   <input type="date" value={f.fv_to}   onChange={(e) => setF((s) => ({ ...s, fv_to: e.target.value, prox30:false, page: 1 }))} /></div>

        <label style={{ gridColumn: "span 2", display: "flex", alignItems: "center", gap: 8 }}>
          <input type="checkbox" checked={f.prox30} onChange={toggleProx30} />
          Solo próximos a vencer (≤ 30 días)
        </label>

        <div style={{ gridColumn: "span 6", display: "flex", gap: 8 }}>
          <button onClick={limpiarFiltros}>Limpiar filtros</button>
        </div>
      </div>

      {/* Tabla */}
      <table width="100%" cellPadding={6} style={{ borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th align="left">Título</th>
            <th align="left">Descripción</th>
            <th>Estado</th>
            <th>Firma</th>
            <th>Vencimiento</th>
            <th>Archivo</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const d = daysLeft(r.fecha_vencimiento);
            const resaltado = d === 0 ? "#fee2e2" : undefined; // rojo claro cuando 0d
            return (
              <tr key={r.id} style={{ borderTop: "1px solid #eee", background: resaltado }}>
                <td>{r.titulo}</td>
                <td>{r.descripcion?.slice(0, 60) || "—"}</td>
                <td align="center">{r.estado || "—"}</td>
                <td align="center">{r.fecha_firma || "—"}</td>
                <td align="center"><BadgeVence date={r.fecha_vencimiento} /></td>
                <td align="center">{r.archivo_nombre_original ? "Sí" : "—"}</td>
                <td style={{whiteSpace:"nowrap"}}>
                  <Link to={`/convenios/${r.id}`}>Ver</Link>{" "}
                  <Link to={`/convenios/${r.id}/editar`}>Editar</Link>{" "}
                  <button onClick={() => eliminar(r.id)} style={{marginLeft:4}}>Eliminar</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Paginación */}
      <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center" }}>
        <button disabled={f.page <= 1} onClick={() => setF((s) => ({ ...s, page: s.page - 1 }))}>Anterior</button>
        <span>Página {f.page} / {meta.last_page}</span>
        <button disabled={f.page >= meta.last_page} onClick={() => setF((s) => ({ ...s, page: s.page + 1 }))}>Siguiente</button>
      </div>
    </div>
  );
}