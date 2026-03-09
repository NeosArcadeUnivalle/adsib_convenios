// src/pages/RiesgoKeywords.jsx
import { useEffect, useState, useCallback, useMemo } from "react";
import api from "../api";

/* =================== Colores base (sólo negros / grises) =================== */
const COLORS = {
  bgMain: "#111111ff", // casi negro
  bgCard: "#131313ff",
  bgCard2: "#1d1d1dff",
  bgRow1: "rgba(41, 41, 41, 0.85)",
  bgRow2: "rgba(44, 44, 44, 0.65)",
  bgInput: "#161616ff",
  borderSoft: "rgba(124, 124, 124, 0.45)",
  text: "#e5e7eb",
};

const SEVERITIES = [
  { value: "HIGH", label: "ALTO", bg: "#dc2626", fg: "#fff" },
  { value: "MEDIUM", label: "MEDIO", bg: "#f59e0b", fg: "#111827" },
  { value: "LOW", label: "BAJO", bg: "#10b981", fg: "#064e3b" },
];

const BTN = {
  back: { background: "#141414ff", borderColor: "#363636ff", color: "#e5e7eb" },
  primary: { background: "#0f766e", borderColor: "#0d9488", color: "#ecfeff" },
  neutral: { background: "#1d1d1dff", borderColor: "#535353ff", color: "#e5e7eb" },
  danger: { background: "#7f1d1d", borderColor: "#b91c1c", color: "#fee2e2" },
  disabled: { opacity: 0.5, cursor: "not-allowed" },
};

const BASE_TOKENS = [
  "precio","precios","presupuesto","presupuestario","descuento","descuentos",
  "reemision","reemisiones","minimo","minima","minimos","minimas",
  "orden","cantidad","techo","limite","preferencial","preferenciales",
  "reducido","reducidos","modificable","modificables","unico","unica",
  "compra","compras","bajo","bajos","alto","altos","medio","medios",
  "obligado","obligados","obligacion","obligaciones",
  "clausula","clausulas","alerta","alertas","temprana","tempranas"
];

const normalizeToken = (t) => {
  const raw = (t || "").toLowerCase().replace(/[^\p{L}]+/gu, "");
  return raw
    .replace(/á/gu, "a")
    .replace(/é/gu, "e")
    .replace(/í/gu, "i")
    .replace(/ó/gu, "o")
    .replace(/ú|ü/gu, "u");
};

const levenshtein = (a, b) => {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[m][n];
};

const maxDistanceForLength = (len) => {
  if (len <= 4) return 1;
  if (len <= 7) return 2;
  return 3;
};

export default function RiesgoKeywords() {
  const [items, setItems] = useState([]);
  const [meta, setMeta] = useState({ page: 1, per: 10, total: 0, hasMore: false });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  // filtros
  const [q, setQ] = useState("");
  const [severityFilter, setSeverityFilter] = useState("");
  const [onlyActive, setOnlyActive] = useState(true);

  // form
  const [editingId, setEditingId] = useState(null);
  const [texto, setTexto] = useState("");
  const [severity, setSeverity] = useState("MEDIUM");
  const [reason, setReason] = useState("");
  const [activo, setActivo] = useState(true);
  const [saving, setSaving] = useState(false);
  const [textoIssue, setTextoIssue] = useState("");
  const [remoteKnownTokens, setRemoteKnownTokens] = useState([]);

  const knownTokens = useMemo(() => {
    const set = new Set(BASE_TOKENS.map(normalizeToken));
    remoteKnownTokens.forEach((tok) => {
      const norm = normalizeToken(tok);
      if (norm) set.add(norm);
    });
    items.forEach((it) => {
      const t = it?.texto || "";
      const tokens = t.match(/\p{L}+/gu) || [];
      tokens.forEach((tok) => {
        const norm = normalizeToken(tok);
        if (norm) set.add(norm);
      });
    });
    return set;
  }, [items, remoteKnownTokens]);

  const resetForm = () => {
    setEditingId(null);
    setTexto("");
    setTextoIssue("");
    setSeverity("MEDIUM");
    setReason("");
    setActivo(true);
  };

  /* =============== Cargar lista (10 en 10, filtros auto) =============== */
  const load = useCallback(
    async (page = 1) => {
      setLoading(true);
      setErr("");
      try {
        const { data } = await api.get("/riesgos/keywords", {
          params: {
            page,
            per: 10,
            q: q || undefined,
            severity: severityFilter || undefined,
            only_active: onlyActive ? "true" : "false",
          },
        });
        setItems(Array.isArray(data?.data) ? data.data : []);
        setMeta(
          data?.meta || {
            page,
            per: 10,
            total: data?.data?.length || 0,
            hasMore: false,
          }
        );
      } catch (e) {
        setErr(
          e?.response?.data?.message || "No se pudieron cargar los términos."
        );
      } finally {
        setLoading(false);
      }
    },
    [q, severityFilter, onlyActive]
  );

  // cargar al entrar y cada vez que cambian filtros
  useEffect(() => {
    load(1);
  }, [load]);

  useEffect(() => {
    let mounted = true;
    const loadKnownTokens = async () => {
      try {
        const { data } = await api.get("/riesgos/keywords/known-tokens");
        if (!mounted) return;
        setRemoteKnownTokens(Array.isArray(data?.data) ? data.data : []);
      } catch (_) {
        if (!mounted) return;
        setRemoteKnownTokens([]);
      }
    };
    loadKnownTokens();
    return () => {
      mounted = false;
    };
  }, []);

  const totalPages = Math.max(1, Math.ceil((meta.total || 0) / (meta.per || 10)));

  /* =================== acciones CRUD =================== */
  const onEdit = (it) => {
    setEditingId(it.id);
    setTexto(it.texto || "");
    setTextoIssue("");
    setSeverity(it.severity || "MEDIUM");
    setReason(it.reason || "");
    setActivo(Boolean(it.activo));
  };

  const validateTexto = useCallback((value) => {
    const raw = (value || "").trim();
    if (!raw) return "El texto es obligatorio.";
    if (raw.length < 3) return "Muy corto. Agrega mas letras.";
    const letters = raw.replace(/[^\p{L}]+/gu, "").length;
    if (letters < 3) return "Muy pocas letras.";
    const ratio = letters / raw.length;
    if (ratio < 0.4) return "Demasiados simbolos o numeros.";
    if (!raw.includes(" ")) {
      const lower = raw.toLowerCase();
      const allowStems = [
        "precio","presup","descuent","reemision","minim","orden",
        "cantidad","techo","limite","preferenc","reduc","modific",
        "unico","compra","bajo","alto","medio"
      ];
      const hasStem = allowStems.some((s) => lower.includes(s));
      if (raw.length >= 8 && !hasStem) {
        if (/[bcdfghjklmnñpqrstvwxyz]{3,}/i.test(lower)) {
          return "Palabra incoherente. Usa un termino reconocible o una frase.";
        }
      }
    }

    const tokens = raw.match(/\p{L}+/gu) || [];
    const typoFindings = [];
    const unknownWords = [];
    for (const tok of tokens) {
      const norm = normalizeToken(tok);
      if (!norm || norm.length < 3) continue;
      if (/^[A-Z]{2,}$/u.test(tok)) continue;
      if (knownTokens.has(norm)) continue;
      let best = null;
      let bestDist = 99;
      knownTokens.forEach((k) => {
        if (Math.abs(k.length - norm.length) > 2) return;
        const d = levenshtein(norm, k);
        if (d < bestDist) {
          bestDist = d;
          best = k;
        }
      });
      if (best && bestDist <= maxDistanceForLength(norm.length)) {
        typoFindings.push({ token: tok, suggestion: best });
        continue;
      }
      unknownWords.push(tok);
    }

    if (typoFindings.length > 0) {
      const first = typoFindings[0];
      return `Posible error: "${first.token}" -> "${first.suggestion}".`;
    }

    if (tokens.length === 1 && unknownWords.length > 0) {
      return `Palabra no reconocida: "${unknownWords[0]}". Verifica ortografia.`;
    }

    return "";
  }, [knownTokens]);

  const onSubmit = async (e) => {
    e.preventDefault();
    const issue = validateTexto(texto);
    if (issue) {
      setTextoIssue(issue);
      alert(issue);
      return;
    }
    setSaving(true);
    setErr("");
    try {
      if (editingId) {
        await api.put(`/riesgos/keywords/${editingId}`, {
          texto,
          severity,
          reason,
          activo,
        });
      } else {
        await api.post("/riesgos/keywords", {
          texto,
          severity,
          reason,
          activo,
        });
      }
      resetForm();
      await load(meta.page || 1);
    } catch (e) {
      setErr(
        e?.response?.data?.message ||
          "No se pudo guardar el término de riesgo."
      );
    } finally {
      setSaving(false);
    }
  };

  const onDeactivate = async (item) => {
    if (!window.confirm(`¿Desactivar el término "${item.texto}"?`)) return;
    try {
      await api.delete(`/riesgos/keywords/${item.id}`);
      // recargar misma página
      await load(meta.page || 1);
    } catch (e) {
      alert(
        e?.response?.data?.message ||
          "No se pudo desactivar el término de riesgo."
      );
    }
  };

  /* =================== UI =================== */
  return (
    <div
      className="card"
      style={{
        padding: 18,
        background: COLORS.bgMain,
        borderRadius: 16,
      }}
    >
      {/* HEADER (solo botón + título, sin texto a la derecha) */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 10,
          flexWrap: "wrap",
        }}
      >
        <h2 style={{ margin: 0, fontSize: 20, color: COLORS.text }}>
          Clausulas de riesgo
        </h2>
      </div>

      {/* FILTROS (sin botón Aplicar filtros) */}
      <div
        style={{
          background: COLORS.bgCard2,
          borderRadius: 12,
          padding: 10,
          display: "flex",
          flexWrap: "wrap",
          gap: 10,
          alignItems: "center",
          border: `1px solid ${COLORS.borderSoft}`,
        }}
      >
        <input
          placeholder="Buscar por texto…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{
            minWidth: 260,
            maxWidth: 420,
            background: COLORS.bgInput,
            color: COLORS.text,
            borderRadius: 999,
            border: `1px solid ${COLORS.borderSoft}`,
            padding: "6px 12px",
            fontSize: 13,
          }}
        />

        <select
          value={severityFilter}
          onChange={(e) => setSeverityFilter(e.target.value)}
          style={{
            background: COLORS.bgInput,
            color: COLORS.text,
            borderRadius: 999,
            border: `1px solid ${COLORS.borderSoft}`,
            padding: "6px 10px",
            fontSize: 13,
          }}
        >
          <option value="">Todas las severidades</option>
          {SEVERITIES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>

        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 13,
          }}
        >
          <input
            type="checkbox"
            checked={onlyActive}
            onChange={(e) => setOnlyActive(e.target.checked)}
          />
          Solo activos
        </label>
      </div>

      {err && (
        <div
          style={{
            marginTop: 8,
            background: "#7f1d1d",
            borderRadius: 8,
            padding: 8,
            fontSize: 13,
            color: "#fee2e2",
          }}
        >
          {err}
        </div>
      )}

      {/* LAYOUT: listado + formulario */}
      <div
        style={{
          marginTop: 14,
          display: "grid",
          gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1.3fr)",
          gap: 14,
        }}
      >
        {/* LISTADO */}
        <div
          className="card"
          style={{
            background: COLORS.bgCard,
            borderRadius: 12,
            padding: 10,
            border: `1px solid ${COLORS.borderSoft}`,
          }}
        >
          {/* Cabecera tabla */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 110px 80px 130px",
              fontSize: 12,
              fontWeight: 600,
              paddingBottom: 6,
              borderBottom: "1px solid rgba(148,163,184,.4)",
            }}
          >
            <div>Texto</div>
            <div>Severidad</div>
            <div>Activo</div>
            <div style={{ textAlign: "right" }}>Acciones</div>
          </div>

          {/* Filas */}
          {loading ? (
            <div style={{ padding: 10, fontSize: 12, opacity: 0.8 }}>
              Cargando…
            </div>
          ) : items.length === 0 ? (
            <div style={{ padding: 10, fontSize: 12, opacity: 0.8 }}>
              No hay clausulas encontradas.
            </div>
          ) : (
            <div>
              {items.map((it, idx) => {
                const sev = SEVERITIES.find((s) => s.value === it.severity);
                const bg = idx % 2 === 0 ? COLORS.bgRow1 : COLORS.bgRow2;
                return (
                  <div
                    key={it.id}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 110px 80px 130px",
                      fontSize: 12,
                      padding: "7px 6px",
                      background: bg,
                      borderTop: "1px solid rgba(0, 0, 0, 0.6)",
                      alignItems: "center",
                    }}
                  >
                    <div style={{ paddingRight: 6 }}>{it.texto}</div>

                    <div>
                      {sev ? (
                        <span
                          style={{
                            display: "inline-block",
                            padding: "2px 8px",
                            borderRadius: 999,
                            background: sev.bg,
                            color: sev.fg,
                            fontSize: 11,
                            fontWeight: 600,
                          }}
                        >
                          {sev.label}
                        </span>
                      ) : (
                        "-"
                      )}
                    </div>

                    <div>{it.activo ? "Sí" : "No"}</div>

                    <div
                      style={{
                        display: "flex",
                        justifyContent: "flex-end",
                        gap: 6,
                      }}
                    >
                      <button
                        className="btn"
                        style={{
                          ...BTN.neutral,
                          padding: "2px 8px",
                          fontSize: 11,
                          borderRadius: 999,
                        }}
                        onClick={() => onEdit(it)}
                      >
                        Editar
                      </button>
                      <button
                        className="btn"
                        style={{
                          ...BTN.danger,
                          padding: "2px 8px",
                          fontSize: 11,
                          borderRadius: 999,
                        }}
                        onClick={() => onDeactivate(it)}
                      >
                        Desactivar
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Paginador 10 en 10 */}
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              gap: 10,
              alignItems: "center",
              fontSize: 12,
              marginTop: 10,
            }}
          >
            <button
              className="btn"
              style={{
                ...BTN.neutral,
                ...(meta.page <= 1 ? BTN.disabled : {}),
                padding: "4px 10px",
                borderRadius: 999,
              }}
              disabled={meta.page <= 1}
              onClick={() => load(meta.page - 1)}
            >
              ◀ Anterior
            </button>

            <span style={{ opacity: 0.85 }}>
              Página {meta.page} de {totalPages}
            </span>

            <button
              className="btn"
              style={{
                ...BTN.neutral,
                ...(meta.page >= totalPages || !meta.hasMore
                  ? BTN.disabled
                  : {}),
                padding: "4px 10px",
                borderRadius: 999,
              }}
              disabled={meta.page >= totalPages || !meta.hasMore}
              onClick={() => load(meta.page + 1)}
            >
              Siguiente ▶
            </button>
          </div>
        </div>

        {/* FORMULARIO */}
        <div
          className="card"
          style={{
            background: COLORS.bgCard,
            borderRadius: 12,
            padding: 12,
            border: `1px solid ${COLORS.borderSoft}`,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 6,
            }}
          >
            <h3 style={{ margin: 0, fontSize: 16, color: COLORS.text }}>
              {editingId ? "Editar Clausula" : "Nueva Clausula"}
            </h3>
            {editingId && (
              <button
                type="button"
                className="btn"
                style={{
                  ...BTN.neutral,
                  padding: "3px 10px",
                  fontSize: 11,
                  borderRadius: 999,
                }}
                onClick={resetForm}
              >
                Regresar
              </button>
            )}
          </div>

          <form onSubmit={onSubmit}>
            <div style={{ marginBottom: 8 }}>
              <label
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  display: "block",
                  marginBottom: 2,
                }}
              >
                Texto del término
              </label>
              <textarea
                rows={2}
                value={texto}
                onChange={(e) => {
                  const v = e.target.value;
                  setTexto(v);
                  setTextoIssue(validateTexto(v));
                }}
                spellCheck
                lang="es"
                autoCorrect="on"
                autoCapitalize="sentences"
                style={{
                  width: "100%",
                  background: COLORS.bgInput,
                  color: COLORS.text,
                  borderRadius: 8,
                  border: `1px solid ${COLORS.borderSoft}`,
                  padding: "6px 8px",
                  resize: "vertical",
                  fontSize: 13,
                }}
              />
              {textoIssue && (
                <div style={{ marginTop: 6, fontSize: 12, color: "#f59e0b" }}>
                  {textoIssue}
                </div>
              )}
            </div>

            <div style={{ marginBottom: 8 }}>
              <label
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  display: "block",
                  marginBottom: 2,
                }}
              >
                Severidad
              </label>
              <select
                value={severity}
                onChange={(e) => setSeverity(e.target.value)}
                style={{
                  width: "100%",
                  background: COLORS.bgInput,
                  color: COLORS.text,
                  borderRadius: 8,
                  border: `1px solid ${COLORS.borderSoft}`,
                  padding: "6px 8px",
                  fontSize: 13,
                }}
              >
                {SEVERITIES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ marginBottom: 8 }}>
              <label
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  display: "block",
                  marginBottom: 2,
                }}
              >
                Motivo (explicación)
              </label>
              <textarea
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                style={{
                  width: "100%",
                  background: COLORS.bgInput,
                  color: COLORS.text,
                  borderRadius: 8,
                  border: `1px solid ${COLORS.borderSoft}`,
                  padding: "6px 8px",
                  resize: "vertical",
                  fontSize: 13,
                }}
              />
            </div>

            <div
              style={{
                marginBottom: 12,
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 12,
              }}
            >
              <input
                type="checkbox"
                checked={activo}
                onChange={(e) => setActivo(e.target.checked)}
              />
              <span>Activo</span>
            </div>

            <button
              className="btn"
              type="submit"
              disabled={saving || Boolean(textoIssue)}
              style={{
                ...BTN.primary,
                ...(saving || textoIssue ? BTN.disabled : {}),
                padding: "7px 14px",
                borderRadius: 999,
                fontSize: 13,
              }}
            >
              {saving
                ? "Guardando…"
                : editingId
                ? "Actualizar término"
                : "Crear término"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

