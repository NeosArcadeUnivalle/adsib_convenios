import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import DiffMatchPatch from "diff-match-patch";
import api from "../api";

/* ===== helpers ===== */

// Escapar HTML para mostrar el texto de forma segura,
// pero dejando comillas normales (para que NO se vean &quot; / &apos;)
const escapeHtml = (s = "") =>
  s.replace(/[&<>]/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
  }[m]));

// Decodificar las entidades HTML típicas (&quot;, &apos;, &amp;, &lt;, &gt;)
// Esto limpia texto viejo que quedó con códigos raros en BD.
const decodeHtmlEntities = (t = "") =>
  t
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");

// Detectar número de página a partir de una línea
const pageFromLine = (line) => {
  const m = /(p[áa]gina|page)\s+(\d+)/i.exec(line || "");
  return m ? parseInt(m[2], 10) : null;
};

// Saber si una línea es SOLO el marcador de página (cabecera / pie)
// y no queremos mostrarla como fila (“Página 2 de 3”, etc.)
const isPageMarkerLine = (line = "") => {
  const l = line.trim();
  return /^p[áa]gina\s+\d+(\s+de\s+\d+)?$/i.test(l);
};

// Normalizar texto antes del diff:
// - decodifica entidades HTML (&quot; -> " etc.)
// - normaliza saltos de línea
// - quita prefijos numéricos largos (códigos de imagen, etc.)
// - colapsa espacios
// - descarta líneas sin letras o casi todo números/símbolos
// - descarta líneas que son solo comillas (aunque tengan espacios)
const normalizeTextForDiff = (t = "") =>
  decodeHtmlEntities(t) // <<< PRIMERO limpiamos entidades HTML
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => {
      let l = line.replace(/\s+/g, " ").trim();
      if (!l) return "";

      // quitar prefijos numéricos/códigos (>=8 chars de dígitos/separadores)
      l = l.replace(/^[0-9\-.,/]{8,}\s*/u, "").trim();
      return l;
    })
    .filter((l) => {
      if (!l) return false;

      // si al quitar espacios sólo quedan comillas => ruido
      const noSpaces = l.replace(/\s+/g, "");
      if (/^['"“”‘’«»`´]+$/u.test(noSpaces)) return false;

      const len = l.length;
      if (!len) return false;

      const letters = (l.match(/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g) || []).length;

      // si no hay letras o son menos del 25% => basura numérica/códigos
      if (!letters || letters / len < 0.25) return false;

      return true;
    })
    .join("\n");

/** Diff a NIVEL DE LÍNEA */
function buildLineDiff(aText = "", bText = "") {
  const dmp = new DiffMatchPatch();
  const diffs = dmp.diff_main(aText, bText);
  dmp.diff_cleanupSemantic(diffs);

  const rows = [];
  let la = 1,
    lb = 1;

  // arrancamos en página 1 en ambos lados
  let pa = 1,
    pb = 1;

  const push = (op, line) => {
    const trimmed = (line || "").trim();
    if (!trimmed) return; // no filas vacías

    // Detectar cambio de página ANTES de decidir si mostramos la fila
    const pA = op <= 0 ? pageFromLine(trimmed) : null;
    const pB = op >= 0 ? pageFromLine(trimmed) : null;
    if (pA != null) pa = pA;
    if (pB != null) pb = pB;

    // Si es una línea de cabecera/pie tipo "Página 2 de 3"
    // la usamos solo para actualizar pa/pb, pero NO la mostramos.
    if (isPageMarkerLine(trimmed)) {
      return;
    }

    if (op === 0) {
      rows.push({
        op,
        aNum: la,
        bNum: lb,
        aPage: pa,
        bPage: pb,
        text: trimmed,
      });
      la++;
      lb++;
    } else if (op === -1) {
      rows.push({
        op,
        aNum: la,
        bNum: "",
        aPage: pa,
        bPage: "",
        text: trimmed,
      });
      la++;
    } else {
      rows.push({
        op,
        aNum: "",
        bNum: lb,
        aPage: "",
        bPage: pb,
        text: trimmed,
      });
      lb++;
    }
  };

  for (const [op, data] of diffs) {
    const parts = (data ?? "").toString().split("\n");
    for (let i = 0; i < parts.length; i++) push(op, parts[i]);
  }
  return rows;
}

/* ===== estilos locales de botones ===== */
const BTN = {
  back: { background: "#374151", borderColor: "#4b5563", color: "#e5e7eb" },
  action: { background: "#1a6779", borderColor: "#125463", color: "#fff" },
  dark: { background: "#111827", borderColor: "#1f2937", color: "#e5e7eb" },
  disabled: { opacity: 0.7, cursor: "not-allowed" },
};

export default function ConvenioComparar() {
  const { id } = useParams();

  const [conv, setConv] = useState(null);
  const [versiones, setVersiones] = useState([]);
  const [selA, setSelA] = useState("");
  const [selB, setSelB] = useState("");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  // búsqueda
  const [q, setQ] = useState("");
  const matches = useMemo(() => {
    if (!q) return [];
    const idxs = [];
    rows.forEach((r, i) => {
      if (r.text && r.text.toLowerCase().includes(q.toLowerCase()))
        idxs.push(i);
    });
    return idxs;
  }, [q, rows]);
  const [cur, setCur] = useState(0);
  const containerRef = useRef(null);

  const load = useCallback(async () => {
    const [a, b] = await Promise.all([
      api.get(`/convenios/${id}`),
      api.get(`/convenios/${id}/versiones`, { params: { per_page: 100 } }),
    ]);
    setConv(a.data);

    const payload = b.data;
    const vs = Array.isArray(payload) ? payload : payload?.data || [];
    setVersiones(vs);

    if (vs.length >= 2) {
      const last = vs[0];
      const prev = vs[1]; // se asume orden desc por numero_version
      setSelA(String(prev.id));
      setSelB(String(last.id));
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // Función segura para traer texto (si 422/500 => '')
  const fetchText = async (versionId) => {
    try {
      const { data } = await api.get(`/versiones/${versionId}/texto`);
      return data?.text || "";
    } catch {
      return "";
    }
  };

  const comparar = async (e) => {
    e?.preventDefault();
    if (!selA || !selB || selA === selB) {
      alert("Selecciona dos versiones distintas");
      return;
    }
    try {
      setLoading(true);
      const [rawA, rawB] = await Promise.all([
        fetchText(selA),
        fetchText(selB),
      ]);

      const textA = normalizeTextForDiff(rawA);
      const textB = normalizeTextForDiff(rawB);

      const rs = buildLineDiff(textA, textB);
      setRows(rs);
      setCur(0);
    } catch (err) {
      alert(
        err?.response?.data?.message ||
          "No se pudo comparar (¿archivo soportado?)"
      );
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setCur(0);
  }, [q]);

  const gotoMatch = (dir) => {
    if (!matches.length) return;
    const next =
      (cur + (dir === "next" ? 1 : -1) + matches.length) % matches.length;
    setCur(next);
    const idx = matches[next];
    const el = containerRef.current?.querySelector(`[data-row="${idx}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <div className="card" style={{ padding: 20 }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
          marginBottom: 6,
        }}
      >
        <Link to={`/convenios/${id}`} className="btn" style={BTN.back}>
          Volver al convenio
        </Link>
        <h2 style={{ margin: 0 }}>
          Comparar versiones — {conv?.titulo || "..."}
        </h2>
      </div>

      {/* Controles */}
      <div className="card" style={{ marginTop: 10 }}>
        <form
          onSubmit={comparar}
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <select
            value={selA}
            onChange={(e) => setSelA(e.target.value)}
            disabled={loading}
          >
            <option value="">Versión A…</option>
            {versiones.map((v) => (
              <option key={v.id} value={v.id}>
                v{v.numero_version}
              </option>
            ))}
          </select>
          <span>vs</span>
          <select
            value={selB}
            onChange={(e) => setSelB(e.target.value)}
            disabled={loading}
          >
            <option value="">Versión B…</option>
            {versiones.map((v) => (
              <option key={v.id} value={v.id}>
                v{v.numero_version}
              </option>
            ))}
          </select>

          <button
            className="btn"
            style={{
              ...BTN.action,
              ...((!selA || !selB || selA === selB || loading) && BTN.disabled),
            }}
            disabled={!selA || !selB || selA === selB || loading}
          >
            {loading ? "Comparando..." : "Comparar"}
          </button>

          <div
            style={{
              marginLeft: "auto",
              display: "flex",
              gap: 8,
              alignItems: "center",
            }}
          >
            <input
              placeholder="Buscar en resultado…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              style={{ minWidth: 220 }}
            />
            <button
              type="button"
              className="btn"
              style={{ ...BTN.dark, ...(!matches.length && BTN.disabled) }}
              disabled={!matches.length}
              onClick={() => gotoMatch("prev")}
            >
              ◀
            </button>
            <button
              type="button"
              className="btn"
              style={{ ...BTN.dark, ...(!matches.length && BTN.disabled) }}
              disabled={!matches.length}
              onClick={() => gotoMatch("next")}
            >
              ▶
            </button>
            <span style={{ fontSize: 12, opacity: 0.8 }}>
              {matches.length ? `${cur + 1}/${matches.length}` : "0 resultados"}
            </span>
          </div>
        </form>

        {/* Leyenda */}
        <div
          style={{
            marginTop: 10,
            display: "flex",
            gap: 10,
            fontSize: 12,
            flexWrap: "wrap",
          }}
        >
          <span
            style={{
              background: "#7f1d1d",
              color: "#fff",
              padding: "2px 8px",
              borderRadius: 6,
            }}
          >
            eliminado (A)
          </span>
          <span
            style={{
              background: "#14532d",
              color: "#fff",
              padding: "2px 8px",
              borderRadius: 6,
            }}
          >
            agregado (B)
          </span>
        </div>
      </div>

      {/* Resultado */}
      <div className="card" style={{ marginTop: 10 }}>
        <div ref={containerRef} style={{ maxHeight: 480, overflow: "auto" }}>
          <table
            className="table"
            style={{
              minWidth: 820,
              borderCollapse: "collapse",
              fontFamily:
                "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
              fontSize: 13,
            }}
          >
            <thead style={{ position: "sticky", top: 0 }}>
              <tr>
                <th style={{ width: 70, textAlign: "right" }}>Pág. A</th>
                <th style={{ width: 70, textAlign: "right" }}>Línea A</th>
                <th>Texto</th>
                <th style={{ width: 70, textAlign: "right" }}>Pág. B</th>
                <th style={{ width: 70, textAlign: "right" }}>Línea B</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const isAdd = r.op === 1;
                const isDel = r.op === -1;
                let text = escapeHtml(r.text || "");
                if (q) {
                  const re = new RegExp(
                    `(${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`,
                    "gi"
                  );
                  text = text.replace(
                    re,
                    '<mark style="background:#f59e0b;color:#111827;border-radius:3px;padding:0 2px">$1</mark>'
                  );
                }
                return (
                  <tr
                    key={i}
                    data-row={i}
                    style={{
                      background: isAdd
                        ? "#14532d"
                        : isDel
                        ? "#7f1d1d"
                        : "transparent",
                      color: isAdd || isDel ? "#fff" : "inherit",
                      borderTop: "1px solid rgba(255,255,255,.08)",
                    }}
                  >
                    <td align="right">{r.aPage || ""}</td>
                    <td align="right">{r.aNum || ""}</td>
                    <td dangerouslySetInnerHTML={{ __html: text }} />
                    <td align="right">{r.bPage || ""}</td>
                    <td align="right">{r.bNum || ""}</td>
                  </tr>
                );
              })}
              {!rows.length && (
                <tr>
                  <td colSpan={5} style={{ padding: 12, opacity: 0.8 }}>
                    Sin resultado. Elige dos versiones y presiona “Comparar”.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}