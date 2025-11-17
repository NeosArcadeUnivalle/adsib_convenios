import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import api from "../api";

/* =================== Paletas =================== */
const RISK = {
  ALTO: { bg: "#991b1b", fg: "#fff", label: "ALTO" },
  MEDIO: { bg: "#92400e", fg: "#fff", label: "MEDIO" },
  BAJO: { bg: "#065f46", fg: "#fff", label: "BAJO" },
  DEFAULT: { bg: "#374151", fg: "#fff", label: "—" },
};
const levelStyle = (lvl) => RISK[lvl] || RISK.DEFAULT;

const SEV = {
  HIGH: { bg: "#dc2626", fg: "#fff", label: "ALTO" },
  MEDIUM: { bg: "#f59e0b", fg: "#111827", label: "MEDIO" },
  LOW: { bg: "#10b981", fg: "#0b2f26", label: "BAJO" },
  NONE: { bg: "#6b7280", fg: "#fff", label: "N/A" },
};
const RING = {
  HIGH: "rgba(220,38,38,.45)",
  MEDIUM: "rgba(245,158,11,.45)",
  LOW: "rgba(16,185,129,.45)",
  NONE: "rgba(107,114,128,.35)",
};

const SEMANTIC = { bg: "#60a5fa", fg: "#0b213c", ring: "rgba(96,165,250,.35)" };

const BTN = {
  back: { background: "#374151", borderColor: "#4b5563", color: "#e5e7eb" },
  primary: { background: "#1a6779", borderColor: "#125463", color: "#fff" },
  neutral: { background: "#111827", borderColor: "#1f2937", color: "#e5e7eb" },
  disabled: { opacity: 0.6, cursor: "not-allowed" },
};

/* =================== helpers =================== */
const normalize = (s = "") =>
  s.replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").trim();

const esc = (s = "") =>
  s.replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[m]));

const stripAccents = (s = "") =>
  s.normalize?.("NFD").replace(/[\u0300-\u036f]/g, "") ?? s;

/** Canoniza un token para juntar variantes (plurales, acentos, espacios) */
function canonToken(s = "") {
  let t = stripAccents(String(s).toLowerCase().trim()).replace(/\s+/g, " ");
  const singularizeWord = (w) => {
    if (w.length <= 4) return w;
    if (/[^aeiou]es$/.test(w)) return w.slice(0, -2);
    if (/s$/.test(w)) return w.slice(0, -1);
    return w;
  };
  t = t
    .split(" ")
    .map(singularizeWord)
    .join(" ");
  return t;
}

/** Ubicación (página/fila) basada en \f y saltos de línea reales */
function buildLinesIndex(text = "") {
  const lines = [];
  let page = 1,
    line = 1;
  let start = 0,
    buf = "";
  const pushLine = (endIdx) => {
    lines.push({ page, line, start, end: endIdx, text: buf });
    line += 1;
    buf = "";
    start = endIdx + 1;
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\f") {
      if (buf.length) {
        pushLine(i - 1);
      }
      page += 1;
      line = 1;
      start = i + 1;
      buf = "";
      continue;
    }
    if (ch === "\n") {
      pushLine(i);
      continue;
    }
    buf += ch;
  }
  if (start <= text.length) {
    lines.push({ page, line, start, end: text.length, text: buf });
  }
  return lines;
}

/** Dado un índice absoluto, devuelve {page,line} usando el índice de líneas real */
function pageLineFromIndexUsing(lines, absIndex) {
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];
    if (absIndex >= L.start && absIndex < L.end)
      return { page: L.page, line: L.line };
  }
  for (let i = lines.length - 1; i >= 0; i--) {
    if (absIndex >= lines[i].start)
      return { page: lines[i].page, line: lines[i].line };
  }
  return { page: 1, line: 1 };
}

const styleFromMatch = (m) => {
  const sev = (m?.severity || "NONE").toUpperCase();
  if ((m?.source || "").toLowerCase() === "semantic") {
    return {
      bg: SEMANTIC.bg,
      fg: SEMANTIC.fg,
      ring: SEMANTIC.ring,
      kind: "semantic",
      severity: sev,
    };
  }
  return { ...(SEV[sev] || SEV.NONE), kind: "rule", severity: sev };
};

/** Mapa token-canónico -> estilo (anticipación > regla; mayor severidad > menor). */
function buildTokenStyles(matches = []) {
  const map = new Map();
  const rank = { HIGH: 3, MEDIUM: 2, LOW: 1, NONE: 0 };
  const put = (key, base) => {
    const prev = map.get(key);
    if (!prev) {
      map.set(key, base);
      return;
    }
    if (base.kind === "semantic" && prev.kind !== "semantic") {
      map.set(key, base);
      return;
    }
    if (prev.kind === "semantic" && base.kind !== "semantic") {
      return;
    }
    if (rank[base.severity] > rank[prev.severity]) map.set(key, base);
  };
  matches.forEach((m) => {
    const raw = (m.token || "").trim();
    if (!raw) return;
    const base = styleFromMatch(m);
    const kCanon = canonToken(raw);
    const kSans = stripAccents(kCanon);
    put(kCanon, base);
    if (kSans !== kCanon) put(kSans, base);
  });
  return map;
}

/** RegExp tolerante a espacios/acentos para un token. */
const tokenRegex = (token) => {
  const t = stripAccents(String(token).toLowerCase());
  const escTok = t
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\s+/g, "\\s+");
  return new RegExp(escTok, "gi");
};

/**
 * Snippets desde matches:
 * - usa offsets si existen; si no, cae a regex.
 * - DEDUP por (token canónico + página + línea) para no repetir el mismo fragmento.
 */
function makeSnippetsFromMatches(text = "", matches = [], linesIndex = [], max = 24) {
  const out = [];
  const base = stripAccents(text).toLowerCase();
  const seen = new Set();

  for (const m of matches || []) {
    const st = styleFromMatch(m);
    const rawTok = (m.token || "").trim();
    const tokCanon = canonToken(rawTok);

    // con offsets exactos
    if (Number.isInteger(m.start) && Number.isInteger(m.end) && m.end > m.start) {
      const s = Math.max(0, m.start),
        e = Math.min(text.length, m.end);
      const leftNL = text.lastIndexOf("\n", s - 1);
      const rightNL = text.indexOf("\n", e);
      const ctxS = Math.max(
        0,
        leftNL !== -1 ? leftNL + 1 : Math.max(0, s - 160)
      );
      const ctxE = Math.min(
        text.length,
        rightNL !== -1 ? rightNL : Math.min(text.length, e + 220)
      );
      const raw = text.slice(ctxS, ctxE).trim();
      const loc = pageLineFromIndexUsing(linesIndex, s);
      const key = `${tokCanon}|p${loc.page}|l${loc.line}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({
          token: rawTok || "",
          raw,
          style: st,
          startAbs: ctxS,
          endAbs: ctxE,
          page: loc.page,
          line: loc.line,
        });
      }
      if (out.length >= max) break;
      continue;
    }

    // sin offsets: regex
    if (!rawTok) continue;
    const re = tokenRegex(rawTok);
    let mt;
    while ((mt = re.exec(base)) !== null) {
      const sIdx = mt.index,
        eIdx = sIdx + mt[0].length;
      const leftNL = text.lastIndexOf("\n", sIdx - 1);
      const rightNL = text.indexOf("\n", eIdx);
      const ctxS = Math.max(
        0,
        leftNL !== -1 ? leftNL + 1 : Math.max(0, sIdx - 160)
      );
      const ctxE = Math.min(
        text.length,
        rightNL !== -1 ? rightNL : Math.min(text.length, eIdx + 220)
      );
      const raw = text.slice(ctxS, ctxE).trim();
      const loc = pageLineFromIndexUsing(linesIndex, sIdx);
      const key = `${tokCanon}|p${loc.page}|l${loc.line}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({
          token: rawTok,
          raw,
          style: st,
          startAbs: ctxS,
          endAbs: ctxE,
          page: loc.page,
          line: loc.line,
        });
      }
      if (out.length >= max) break;
      re.lastIndex = sIdx + Math.max(1, mt[0].length);
    }
    if (out.length >= max) break;
  }
  return out;
}

/** Conteo por token canónico basado en SNIPPETS (fragmentos únicos) */
function countTokensFromSnippets(snippets = []) {
  const map = new Map();
  snippets.forEach((s) => {
    const k = canonToken(s.token || "");
    if (!k) return;
    const bucket = map.get(k) || new Set();
    bucket.add(`p${s.page}|l${s.line}`);
    map.set(k, bucket);
  });
  return [...map.entries()]
    .map(([token, set]) => ({ token, count: set.size }))
    .sort((a, b) => b.count - a.count || a.token.localeCompare(b.token));
}

function matchDensity(text = "", tokensCanonUnique = []) {
  if (!text || !tokensCanonUnique?.length) return 0;
  const uniq = [...new Set(tokensCanonUnique)];
  let total = 0;
  uniq.forEach((t) => {
    total += t.length;
  });
  return Math.min(1, total / Math.max(1, text.length));
}

/* ==== Highlighter ==== */
function highlightByMatches(text = "", matches = [], extraQuery = "") {
  if (!text) return { __html: "" };
  const n = text.length;
  const base = stripAccents(text).toLowerCase();

  const primary = new Array(n).fill(null);
  const hasSem = new Array(n).fill(false);
  const sevRank = { HIGH: 3, MEDIUM: 2, LOW: 1, NONE: 0 };

  const paint = (s, e, st) => {
    const S = Math.max(0, s),
      E = Math.min(n, e);
    for (let i = S; i < E; i++) {
      if (!primary[i]) primary[i] = st;
      if (st.kind === "semantic") hasSem[i] = true;
    }
  };

  const ranges = [];
  const addRange = (s, e, st) => {
    if (Number.isFinite(s) && Number.isFinite(e) && e > s)
      ranges.push({ s, e, st });
  };

  (matches || []).forEach((m) => {
    const st = styleFromMatch(m);
    if (Number.isInteger(m.start) && Number.isInteger(m.end) && m.end > m.start) {
      addRange(m.start, m.end, st);
      return;
    }
    const tok = (m.token || "").trim();
    if (!tok) return;
    const re = tokenRegex(tok);
    let mt;
    while ((mt = re.exec(base)) !== null) {
      addRange(mt.index, mt.index + mt[0].length, st);
      re.lastIndex = mt.index + Math.max(1, mt[0].length);
    }
  });

  if (extraQuery) {
    const re = tokenRegex(extraQuery);
    let mt;
    while ((mt = re.exec(base)) !== null) {
      addRange(mt.index, mt.index + mt[0].length, {
        bg: "#fef3c7",
        fg: "#111827",
        kind: "extra",
        severity: "NONE",
      });
      re.lastIndex = mt.index + Math.max(1, mt[0].length);
    }
  }

  ranges.sort((a, b) => {
    const A = a.st,
      B = b.st;
    const rA =
      A.kind === "rule"
        ? 10 + (sevRank[A.severity] || 0)
        : A.kind === "semantic"
        ? 5
        : 0;
    const rB =
      B.kind === "rule"
        ? 10 + (sevRank[B.severity] || 0)
        : B.kind === "semantic"
        ? 5
        : 0;
    if (rB !== rA) return rB - rA;
    const la = a.e - a.s,
      lb = b.e - b.s;
    return lb - la || a.s - b.s;
  });

  ranges.forEach((r) => paint(r.s, r.e, r.st));
  let html = "",
    open = null;
  const openTag = (st, underline) => {
    const ring = st.ring ? `;box-shadow:0 0 0 2px ${st.ring} inset` : "";
    const under = underline
      ? `;box-shadow: inset 0 -2px 0 0 ${SEMANTIC.bg}${ring}`
      : `${ring}`;
    return `<mark style="background:${st.bg};color:${st.fg};border-radius:4px;padding:0 2px${under}">`;
  };
  for (let i = 0; i < n; i++) {
    const st = primary[i];
    const underline = hasSem[i] && (!st || st.kind !== "semantic");
    const key = st ? st.kind + "|" + st.severity + "|" + (underline ? "1" : "0") : null;
    const cur = open
      ? open.kind + "|" + open.severity + "|" + (open.__ul ? "1" : "0")
      : null;
    if (key !== cur) {
      if (open) html += "</mark>";
      if (st) {
        html += openTag(st, underline);
        open = { ...st, __ul: underline };
      } else {
        open = null;
      }
    }
    html += esc(text[i]);
  }
  if (open) html += "</mark>";
  return { __html: html };
}

/* ===== Helpers amigables ===== */
const modelFriendly = (m = "") => {
  const x = (m || "").toLowerCase();
  if (x.includes("tfidf")) return "búsqueda semántica (TF-IDF)";
  if (x.includes("mini") || x.includes("mpnet") || x.includes("paraphrase"))
    return "modelo de similitud (frases)";
  if (x.includes("openai") || x.includes("text-embedding") || x.includes("e5"))
    return "embeddings avanzados";
  if (x.includes("rules")) return "reglas (palabras clave)";
  return m || "motor desconocido";
};

/** Formateo de fecha SOLO FECHA y en zona La Paz */
const fmtFecha = (s) => {
  if (!s) return "—";
  try {
    const hasTZ = /([zZ])|([+-]\d{2}:?\d{2})$/.test(s);
    let iso = s.includes("T") ? s : s.replace(" ", "T");
    if (!hasTZ) iso += "Z";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return s;
    return new Intl.DateTimeFormat("es-BO", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone: "America/La_Paz",
    }).format(d);
  } catch {
    return s;
  }
};

/* =================== Página =================== */
export default function ConvenioRiesgo() {
  const { id } = useParams();

  const [conv, setConv] = useState(null);
  const [versiones, setVersiones] = useState([]);
  const [sel, setSel] = useState("");
  const [texto, setTexto] = useState("");

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const [result, setResult] = useState(null);
  const [history, setHistory] = useState([]);
  const [page, setPage] = useState(1);
  const [histMeta, setHistMeta] = useState({ page: 1, per: 3, total: 0 });
  const [lastAnalysisId, setLastAnalysisId] = useState(null);

  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    const [a, b] = await Promise.all([
      api.get(`/convenios/${id}`),
      api.get(`/convenios/${id}/versiones`, { params: { per_page: 100 } }),
    ]);
    setConv(a.data);
    const arr = Array.isArray(b.data) ? b.data : b.data?.data || [];
    setVersiones(arr);
    if (arr.length) setSel(String(arr[0].id));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const loadText = useCallback(async (vid) => {
    setErr("");
    setTexto("");
    setResult(null);
    if (!vid) return;
    try {
      setLoading(true);
      const { data } = await api.get(`/versiones/${vid}/texto`);
      setTexto(normalize(data?.text || ""));
    } catch (e) {
      setErr(
        e.response?.data?.message ||
          "No se pudo extraer el texto de la versión."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const loadHistory = useCallback(
    async (p = 1) => {
      if (!conv?.id) return;
      try {
        const { data } = await api.get("/analisis", {
          params: { convenio_id: conv.id, page: p, per: 3 },
        });
        const items = Array.isArray(data?.data) ? data.data : [];
        setHistory(items);
        if (items.length) {
          // más reciente primero
          setLastAnalysisId(items[0].id);
        }
        setHistMeta({
          page: data?.meta?.page || p,
          per: data?.meta?.per || 3,
          total: data?.meta?.total || 0,
        });
        setPage(data?.meta?.page || p);
      } catch {
        // silencio
      }
    },
    [conv?.id]
  );

  useEffect(() => {
    if (sel) {
      loadText(sel);
      loadHistory(1);
    }
  }, [sel, loadText, loadHistory]);

  const analizar = useCallback(
    async () => {
      setErr("");
      setResult(null);
      if (!texto.trim()) {
        setErr("No hay texto en esta versión para analizar.");
        return;
      }
      try {
        setLoading(true);
        const { data } = await api.post("/analisis/riesgo", {
          text: texto,
          version_id: sel,
          convenio_id: conv?.id,
        });
        setResult(data || null);
        setLastAnalysisId(data?.saved_id || null);
        await loadHistory(1);
      } catch (e) {
        setErr(
          e.response?.data?.message || "No se pudo analizar el texto."
        );
      } finally {
        setLoading(false);
      }
    },
    [texto, sel, conv?.id, loadHistory]
  );

  const matchesFull = useMemo(() => result?.matches || [], [result]);

  const linesIndex = useMemo(() => buildLinesIndex(texto), [texto]);

  const snippets = useMemo(
    () => makeSnippetsFromMatches(texto, matchesFull, linesIndex, 24),
    [texto, matchesFull, linesIndex]
  );

  const tokenTable = useMemo(
    () => countTokensFromSnippets(snippets),
    [snippets]
  );

  const tokenStyles = useMemo(() => {
    const pseudoMatches = snippets.map((s) => ({
      token: canonToken(s.token || ""),
      source: s.style?.kind === "semantic" ? "semantic" : "rule",
      severity: s.style?.severity || "NONE",
    }));
    return buildTokenStyles(pseudoMatches);
  }, [snippets]);

  const density = useMemo(
    () =>
      matchDensity(
        texto,
        [
          ...new Set(
            snippets
              .map((s) => canonToken(s.token || ""))
              .filter(Boolean)
          ),
        ]
      ),
    [texto, snippets]
  );

  const semanticTokens = useMemo(
    () =>
      snippets
        .filter((s) => s.style?.kind === "semantic")
        .map((s) => canonToken(s.token || "")),
    [snippets]
  );

  const ruleTokens = useMemo(
    () =>
      snippets
        .filter((s) => s.style?.kind !== "semantic")
        .map((s) => canonToken(s.token || "")),
    [snippets]
  );

  const analyzedRows = useMemo(() => {
    return linesIndex.map((L) => {
      const localMatches = (matchesFull || []).flatMap((m) => {
        if (Number.isInteger(m.start) && Number.isInteger(m.end)) {
          const s = Math.max(L.start, m.start);
          const e = Math.min(L.end, m.end);
          if (e > s) {
            return [{ ...m, start: s - L.start, end: e - L.start }];
          }
          return [];
        }
        const tok = (m.token || "").trim();
        if (!tok) return [];
        const re = tokenRegex(tok);
        const base = stripAccents(L.text).toLowerCase();
        let mt,
          out = [];
        while ((mt = re.exec(base)) !== null) {
          out.push({
            token: tok,
            source: m.source,
            severity: m.severity,
            start: mt.index,
            end: mt.index + mt[0].length,
          });
          re.lastIndex = mt.index + Math.max(1, mt[0].length);
        }
        return out;
      });

      const html = highlightByMatches(L.text, localMatches, q).__html;
      return {
        page: L.page,
        line: L.line,
        html,
        key: `${L.page}-${L.line}-${L.start}`,
      };
    });
  }, [linesIndex, matchesFull, q]);

  const copyResumen = async () => {
    const lvl = result?.risk_level || "—";
    const score = result?.score ?? 0;
    const vObj = versiones.find((v) => String(v.id) === String(sel));
    const lines = [
      `Convenio: ${conv?.titulo || id}`,
      `Versión: v${vObj?.numero_version || "—"}`,
      `Nivel de riesgo: ${lvl}`,
      `Confianza: ${(Math.max(0, Math.min(1, score)) * 100).toFixed(0)}%`,
      `Detectadas en lista: ${ruleTokens.length}`,
      `Anticipaciones del modelo: ${semanticTokens.length}`,
      `Densidad aproximada: ${(density * 100).toFixed(1)}%`,
    ];
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      alert("Resumen copiado.");
    } catch {
      alert("No se pudo copiar.");
    }
  };

  const exportPdf = async () => {
    if (!lastAnalysisId) {
      alert("Primero ejecuta un análisis para poder exportar.");
      return;
    }
    try {
      const resp = await api.get(`/analisis/${lastAnalysisId}/pdf`, {
        responseType: "blob",
      });

      const blob = new Blob([resp.data], { type: "application/pdf" });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `analisis_riesgo_${lastAnalysisId}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
      alert("No se pudo descargar el PDF del análisis.");
    }
  };

  const lvl = levelStyle(result?.risk_level);
  const scorePct =
    Math.max(0, Math.min(1, Number(result?.score ?? 0))) * 100;
  const totalPages = Math.max(
    1,
    Math.ceil((histMeta.total || 0) / (histMeta.per || 3))
  );

  return (
    <div className="card" style={{ padding: 18 }}>
      {/* header */}
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
        <h2 style={{ margin: 0, fontSize: 18 }}>
          Análisis de riesgo — {conv?.titulo || "..."}
        </h2>
      </div>

      {/* filtros */}
      <div
        className="card"
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          flexWrap: "wrap",
          padding: 8,
        }}
      >
        <label style={{ fontSize: 13 }}>Versión:</label>
        <select
          value={sel}
          onChange={(e) => setSel(e.target.value)}
          style={{ fontSize: 13 }}
        >
          {(versiones || []).map((v) => (
            <option key={v.id} value={v.id}>
              v{v.numero_version}
            </option>
          ))}
        </select>
        <button
          className="btn"
          style={{ ...BTN.primary, ...(loading ? BTN.disabled : {}) }}
          disabled={loading}
          onClick={analizar}
        >
          {loading ? "Analizando..." : "Analizar"}
        </button>

        <div
          style={{
            marginLeft: "auto",
            display: "flex",
            gap: 10,
            alignItems: "center",
          }}
        >
          <div
            style={{
              display: "flex",
              gap: 6,
              alignItems: "center",
              fontSize: 11,
              opacity: 0.9,
            }}
          >
            <span
              style={{
                background: SEV.HIGH.bg,
                color: SEV.HIGH.fg,
                padding: "2px 6px",
                borderRadius: 6,
              }}
            >
              directo ALTO
            </span>
            <span
              style={{
                background: SEV.MEDIUM.bg,
                color: SEV.MEDIUM.fg,
                padding: "2px 6px",
                borderRadius: 6,
              }}
            >
              directo MEDIO
            </span>
            <span
              style={{
                background: SEV.LOW.bg,
                color: SEV.LOW.fg,
                padding: "2px 6px",
                borderRadius: 6,
              }}
            >
              directo BAJO
            </span>
            <span
              style={{
                background: SEMANTIC.bg,
                color: SEMANTIC.fg,
                padding: "2px 6px",
                borderRadius: 6,
              }}
            >
              anticipación
            </span>
          </div>
          <input
            placeholder="Buscar en texto…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ minWidth: 220, fontSize: 13 }}
          />
        </div>
      </div>

      {err && (
        <div
          className="card"
          style={{
            marginTop: 8,
            borderColor: "#b91c1c",
            color: "#fee2e2",
            background: "#7f1d1d",
            fontSize: 13,
            padding: 8,
          }}
        >
          {err}
        </div>
      )}

      {/* resumen */}
      <div className="card" style={{ marginTop: 8, padding: 10 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 12,
          }}
        >
          <div>
            <div
              style={{
                display: "flex",
                gap: 6,
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              <span
                style={{
                  padding: "5px 10px",
                  borderRadius: 8,
                  background: lvl.bg,
                  color: lvl.fg,
                  fontWeight: 700,
                  fontSize: 13,
                }}
              >
                Nivel: {lvl.label}
              </span>
              <span className="pill" style={{ fontSize: 12 }}>
                Directos: {ruleTokens.length}
              </span>
              <span className="pill" style={{ fontSize: 12 }}>
                Anticipaciones: {semanticTokens.length}
              </span>
              <span className="pill" style={{ fontSize: 12 }}>
                Densidad: {(density * 100).toFixed(1)}%
              </span>
            </div>

            <div style={{ marginTop: 8 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  fontSize: 12,
                }}
              >
                <span style={{ opacity: 0.9 }}>Confianza</span>
                <b>{(scorePct / 100).toFixed(2)}</b>
              </div>
              <div
                style={{
                  height: 8,
                  background: "#111827",
                  borderRadius: 999,
                  marginTop: 6,
                }}
              >
                <div
                  style={{
                    width: `${scorePct}%`,
                    height: "100%",
                    background: lvl.bg,
                    borderRadius: 999,
                    transition: "width .2s",
                  }}
                />
              </div>
            </div>

            <div
              style={{
                marginTop: 8,
                display: "flex",
                gap: 6,
                flexWrap: "wrap",
              }}
            >
              <button
                className="btn"
                style={{ ...BTN.neutral, padding: "6px 10px", fontSize: 12 }}
                onClick={copyResumen}
              >
                Copiar resumen
              </button>

              <button
                className="btn"
                style={{
                  ...BTN.primary,
                  padding: "6px 10px",
                  fontSize: 12,
                  ...(lastAnalysisId ? {} : BTN.disabled),
                }}
                disabled={!lastAnalysisId}
                onClick={exportPdf}
              >
                Exportar PDF
              </button>
            </div>
          </div>

          {/* chips */}
          <div>
            <div
              style={{
                fontWeight: 600,
                marginBottom: 6,
                fontSize: 13,
              }}
            >
              Palabras/expresiones detectadas
            </div>
            {tokenTable.length === 0 ? (
              <div style={{ opacity: 0.8, fontSize: 12 }}>—</div>
            ) : (
              <div
                style={{
                  display: "flex",
                  gap: 6,
                  flexWrap: "wrap",
                }}
              >
                {tokenTable.map((k) => {
                  const st =
                    tokenStyles.get(k.token) || {
                      bg: "#111827",
                      fg: "#e5e7eb",
                      kind: "rule",
                      severity: "NONE",
                    };
                  const label =
                    st.kind === "semantic"
                      ? "anticipación"
                      : SEV[st.severity]?.label || "N/A";
                  return (
                    <span
                      key={k.token}
                      style={{
                        background: st.bg,
                        color: st.fg,
                        padding: "3px 6px",
                        borderRadius: 8,
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        fontSize: 12,
                      }}
                    >
                      {k.token} <span style={{ opacity: 0.9 }}>×{k.count}</span>
                      <span
                        style={{
                          background: "rgba(0,0,0,.18)",
                          padding: "0 6px",
                          borderRadius: 6,
                          fontSize: 11,
                        }}
                      >
                        {label}
                      </span>
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* HISTORIAL */}
      <div className="card" style={{ marginTop: 8, padding: 10 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <h3 style={{ margin: 0, fontSize: 15 }}>Historial de análisis</h3>
        </div>

        {history.length === 0 ? (
          <div style={{ opacity: 0.8, marginTop: 8, fontSize: 12 }}>
            Aún no hay análisis registrados para este convenio.
          </div>
        ) : (
          <>
            <div
              style={{
                marginTop: 8,
                display: "grid",
                gap: 8,
              }}
            >
              {history.map((h) => {
                const fecha = fmtFecha(h.analizado_en || h.created_at);
                const lvlH = levelStyle(h.risk_level);
                const confianza =
                  Math.round(
                    Math.max(
                      0,
                      Math.min(1, Number(h.score ?? 0))
                    ) * 100
                  ) + "%";
                const hallazgos = h.matches ?? 0;
                const motor = modelFriendly(h.modelo);

                return (
                  <div
                    key={h.id}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "150px 1fr",
                      gap: 8,
                      padding: 8,
                      border: "1px solid rgba(255,255,255,.08)",
                      borderRadius: 10,
                      background: "rgba(0,0,0,.25)",
                      fontSize: 12,
                    }}
                  >
                    <div>
                      <div style={{ opacity: 0.8, fontSize: 11 }}>{fecha}</div>
                      <div
                        style={{
                          marginTop: 6,
                          display: "inline-block",
                          padding: "4px 8px",
                          borderRadius: 8,
                          background: lvlH.bg,
                          color: lvlH.fg,
                          fontWeight: 700,
                          fontSize: 11,
                        }}
                      >
                        Riesgo: {lvlH.label}
                      </div>
                    </div>

                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 8,
                        alignItems: "center",
                      }}
                    >
                      <span className="pill">
                        Confianza: <b>{confianza}</b>
                      </span>
                      <span className="pill">
                        Hallazgos: <b>{hallazgos}</b>
                      </span>
                      <span className="pill">
                        Método: <b>{motor}</b>
                      </span>
                      <div
                        style={{
                          minWidth: 140,
                          flex: "0 0 auto",
                        }}
                      >
                        <div
                          style={{
                            opacity: 0.8,
                            fontSize: 11,
                            marginBottom: 4,
                          }}
                        >
                          Nivel de confianza
                        </div>
                        <div
                          style={{
                            height: 6,
                            background: "#111827",
                            borderRadius: 999,
                          }}
                        >
                          <div
                            style={{
                              width: confianza,
                              height: "100%",
                              background: lvlH.bg,
                              borderRadius: 999,
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "center",
                gap: 10,
                marginTop: 10,
                alignItems: "center",
                fontSize: 12,
              }}
            >
              <button
                className="btn"
                style={BTN.neutral}
                onClick={() => loadHistory(page - 1)}
                disabled={!(page > 1)}
              >
                ◀ Anterior
              </button>
              <span style={{ opacity: 0.8 }}>
                Página {page} de {totalPages}
              </span>
              <button
                className="btn"
                style={BTN.neutral}
                onClick={() => loadHistory(page + 1)}
                disabled={!(page < totalPages)}
              >
                Siguiente ▶
              </button>
            </div>
          </>
        )}
      </div>

      {/* fragmentos relevantes */}
      <div className="card" style={{ marginTop: 8, padding: 10 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <h3 style={{ margin: 0, fontSize: 15 }}>Fragmentos relevantes</h3>
          <span style={{ opacity: 0.8, fontSize: 12 }}>
            {snippets.length} fragmentos
          </span>
        </div>

        {snippets.length === 0 ? (
          <div style={{ opacity: 0.8, marginTop: 6, fontSize: 12 }}>
            No se detectaron fragmentos relevantes.
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gap: 6,
              marginTop: 8,
            }}
          >
            {snippets.map((s, i) => {
              const stMain =
                s.style || {
                  bg: "#111827",
                  fg: "#e5e7eb",
                  kind: "rule",
                  severity: "NONE",
                };
              const isSemantic = stMain.kind === "semantic";
              const ringColor = isSemantic
                ? SEMANTIC.ring
                : RING[stMain.severity] || RING.NONE;

              const filterSameType = (m) => {
                const ms = styleFromMatch(m);
                if (isSemantic) return ms.kind === "semantic";
                return ms.kind === "rule" && ms.severity === stMain.severity;
              };

              const localMatches = (matchesFull || []).flatMap((m) => {
                if (!filterSameType(m)) return [];
                if (
                  Number.isInteger(m.start) &&
                  Number.isInteger(m.end) &&
                  s.startAbs != null
                ) {
                  const ovStart = Math.max(m.start, s.startAbs);
                  const ovEnd = Math.min(m.end, s.endAbs);
                  if (ovEnd > ovStart) {
                    return [
                      {
                        ...m,
                        start: ovStart - s.startAbs,
                        end: ovEnd - s.startAbs,
                      },
                    ];
                  }
                  return [];
                }
                const tok = (m.token || "").trim();
                if (!tok) return [];
                const re = tokenRegex(tok);
                if (re.test(stripAccents(s.raw).toLowerCase())) {
                  return [
                    {
                      token: tok,
                      source: m.source,
                      severity: m.severity,
                    },
                  ];
                }
                return [];
              });

              const localHtml = highlightByMatches(
                s.raw,
                localMatches
              ).__html;

              return (
                <div
                  key={`${canonToken(s.token)}|p${s.page}|l${s.line}`}
                  style={{
                    border: "1px solid rgba(255,255,255,.08)",
                    borderRadius: 8,
                    padding: 8,
                    background: "rgba(0,0,0,.25)",
                    boxShadow: `0 0 0 2px ${ringColor} inset`,
                    fontSize: 13,
                  }}
                >
                  <div
                    style={{
                      fontSize: 11.5,
                      opacity: 0.9,
                      marginBottom: 6,
                      display: "flex",
                      gap: 8,
                      alignItems: "center",
                      flexWrap: "wrap",
                    }}
                  >
                    #{i + 1} · {canonToken(s.token)}
                    <span
                      style={{
                        background: stMain.bg,
                        color: stMain.fg,
                        borderRadius: 6,
                        padding: "2px 6px",
                        fontSize: 10.5,
                      }}
                    >
                      {isSemantic
                        ? "anticipación"
                        : SEV[stMain.severity]?.label || "N/A"}
                    </span>
                    <span style={{ opacity: 0.85 }}>
                      p.{s.page ?? "?"} · fila {s.line ?? "?"}
                    </span>
                  </div>
                  <div
                    dangerouslySetInnerHTML={{ __html: localHtml }}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* texto analizado */}
      <div className="card" style={{ marginTop: 8, padding: 10 }}>
        <h3 style={{ margin: 0, fontSize: 15 }}>Texto analizado</h3>
        <div
          style={{
            marginTop: 8,
            border: "1px solid rgba(255,255,255,.08)",
            borderRadius: 8,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "70px 80px 1fr",
              background: "#0f172a",
              color: "#e5e7eb",
              fontWeight: 700,
              padding: "6px 8px",
              fontSize: 12,
            }}
          >
            <div>Pág</div>
            <div>Línea</div>
            <div>Texto</div>
          </div>
          <div
            style={{
              maxHeight: 420,
              overflow: "auto",
              background: "rgba(0,0,0,.15)",
            }}
          >
            {analyzedRows.length === 0 ? (
              <div style={{ padding: 10, opacity: 0.8, fontSize: 12 }}>
                —
              </div>
            ) : (
              analyzedRows.map((r) => (
                <div
                  key={r.key}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "70px 80px 1fr",
                    padding: "6px 8px",
                    borderTop: "1px solid rgba(255,255,255,.06)",
                    fontFamily:
                      "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                    fontSize: 13,
                  }}
                >
                  <div style={{ opacity: 0.85 }}>{r.page}</div>
                  <div style={{ opacity: 0.85 }}>{r.line}</div>
                  <div
                    dangerouslySetInnerHTML={{ __html: r.html }}
                  />
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}