from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import spacy
from typing import List, Optional, Dict, Any
import re
import unicodedata
import math

# ====== opcional: embeddings para "anticipaciones" (cláusulas nuevas) ======
try:
    from sentence_transformers import SentenceTransformer, util
    _EMB_OK = True
    _embedder = SentenceTransformer("paraphrase-multilingual-MiniLM-L12-v2")
except Exception:
    _EMB_OK = False
    _embedder = None

app = FastAPI(title="NLP Risk Service", version="1.2")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_credentials=True,
    allow_methods=["*"], allow_headers=["*"],
)

# ---------- modelos ----------
class AnalyzeIn(BaseModel):
    text: str

class Match(BaseModel):
    token: str
    severity: str  # HIGH | MEDIUM | LOW
    source: str    # keyword | pattern | semantic
    reason: str
    page: Optional[int] = None
    line: Optional[int] = None
    start: Optional[int] = None
    end: Optional[int] = None

class AnalyzeOut(BaseModel):
    risk_level: str        # ALTO | MEDIO | BAJO
    score: float           # 0..1
    matches: List[Match]   # hallazgos con detalle
    summary: Dict[str, Any]

# ---------- utilidades ----------
def _norm(s: str) -> str:
    s = unicodedata.normalize("NFKC", s or "")
    s = s.replace("\r", "")
    return s

_PAGE_RE = re.compile(r"(p[aá]gina|page)\s+(\d+)", re.I)

def _index_lines(text: str):
    """
    Indexa líneas y páginas. Devuelve lista de dicts:
    {idx, page, line, start, end, text}
    """
    out = []
    page = 1
    start = 0
    for i, line in enumerate(text.split("\n")):
        end = start + len(line)
        m = _PAGE_RE.search(line)
        if m:
            try:
                page = int(m.group(2))
            except Exception:
                pass
        out.append({
            "idx": i + 1,
            "page": page,
            "line": i + 1,
            "start": start,
            "end": end,
            "text": line,
        })
        start = end + 1  # +1 por el salto de línea que eliminamos con split
    return out

def _find_occurrences(hay: str, needle: str):
    """Devuelve posiciones start/end (inclusive/exclusivo) de cada match."""
    out = []
    if not needle.strip():
        return out
    lo_hay = hay.lower()
    lo_needle = needle.lower()
    idx = 0
    safe = 0
    while True:
        pos = lo_hay.find(lo_needle, idx)
        if pos == -1 or safe > 10000:
            break
        out.append((pos, pos + len(needle)))
        idx = pos + len(needle)
        safe += 1
    return out

def _char_to_page_line(char_pos: int, index_lines):
    """De posición absoluta de char a (page, line) usando el índice."""
    for item in index_lines:
        if item["start"] <= char_pos <= item["end"]:
            return item["page"], item["line"]
    if index_lines:
        return index_lines[-1]["page"], index_lines[-1]["line"]
    return None, None

# ---------- reglas/keywords ----------
# token -> (severity, reason)
KEYWORDS = {
    "precios preferenciales": ("HIGH",   "Posible trato preferencial de precios."),
    "menores precios":        ("HIGH",   "Referencia a reducción de precios no justificada."),
    "precio preferencial":    ("HIGH",   "Aparente exclusividad de precio."),
    "cantidad mínima":        ("MEDIUM", "Condición de volumen mínimo."),
    "mínimo de compra":       ("MEDIUM", "Condición de volumen mínimo."),
    "orden mínima":           ("MEDIUM", "Condición de volumen mínimo."),
    "reemisiones":            ("MEDIUM", "Cláusula de reemisiones."),
    "mayor cantidad de reemisiones": ("HIGH","Incremento de reemisiones."),
    "presupuesto":            ("LOW",    "Mención a límites presupuestarios."),
    "techo presupuestario":   ("LOW",    "Tope presupuestario."),
    "límite presupuestario":  ("LOW",    "Tope presupuestario."),
    "descuento":              ("LOW",    "Mención a descuentos."),
}

# Patrones con regex (más flexibles)
PATTERNS = [
    (re.compile(r"(precio).{0,10}(preferencial|preferentes?)", re.I), "HIGH",
     "Referencia explícita a 'precio preferencial'."),
    (re.compile(r"(cantidad|orden).{0,12}m[ií]nima", re.I), "MEDIUM",
     "Condición de 'cantidad mínima' o similar."),
    (re.compile(r"mayor\s+cantidad\s+de\s+reemisiones", re.I), "HIGH",
     "Incremento de reemisiones."),
]

# Arquetipos: frases base para similitud semántica (anticipar redacciones nuevas)
ARCHETYPES = [
    ("HIGH",   "El proveedor tendrá precios preferenciales para el contratante."),
    ("HIGH",   "Se permite otorgar descuentos exclusivos a una de las partes."),
    ("MEDIUM", "Se requiere una cantidad mínima de compra para acceder al servicio."),
    ("MEDIUM", "Se autoriza mayor cantidad de reemisiones respecto al límite normal."),
    ("LOW",    "El convenio queda sujeto al límite presupuestario asignado."),
]

# pesos de severidad para score
SEV_W = {"HIGH": 1.0, "MEDIUM": 0.6, "LOW": 0.35}

def _risk_from_score(score: float) -> str:
    if score >= 0.66:
        return "ALTO"
    if score >= 0.33:
        return "MEDIO"
    return "BAJO"

# ---------- análisis ----------
def _analyze(text: str) -> AnalyzeOut:
    text = _norm(text)
    idx = _index_lines(text)
    matches: List[Match] = []

    # 1) keywords exactas
    for tok, (sev, why) in KEYWORDS.items():
        for start, end in _find_occurrences(text, tok):
            p, l = _char_to_page_line(start, idx)
            matches.append(Match(
                token=tok, severity=sev, source="keyword", reason=why,
                page=p, line=l, start=start, end=end
            ))

    # 2) patrones regex
    for rx, sev, why in PATTERNS:
        for m in rx.finditer(text):
            start, end = m.span()
            tok = m.group(0)
            p, l = _char_to_page_line(start, idx)
            matches.append(Match(
                token=tok, severity=sev, source="pattern", reason=why,
                page=p, line=l, start=start, end=end
            ))

    # 3) anticipaciones semánticas (opcional)
    semantic_hits = 0
    if _EMB_OK:
        nlp = spacy.blank("es")
        nlp.add_pipe("sentencizer")
        doc = nlp(text)
        sentences = [s.text.strip() for s in doc.sents if s.text.strip()]
        if sentences:
            S = _embedder.encode(sentences, convert_to_tensor=True, normalize_embeddings=True)
            T = _embedder.encode([t for _, t in ARCHETYPES], convert_to_tensor=True, normalize_embeddings=True)
            sim = util.cos_sim(S, T)  # [num_sent, num_arche]
            for i, sent in enumerate(sentences):
                best_j = int(sim[i].argmax())
                score_sim = float(sim[i][best_j])
                sev_seed, seed_text = ARCHETYPES[best_j]
                sev = None
                if score_sim >= 0.80:
                    sev = "HIGH"
                elif score_sim >= 0.70:
                    sev = "MEDIUM"
                elif score_sim >= 0.60:
                    sev = "LOW"
                if sev:
                    semantic_hits += 1
                    pos = text.find(sent)
                    p, l = _char_to_page_line(max(0, pos), idx)
                    matches.append(Match(
                        token=sent[:100] + ("…" if len(sent) > 100 else ""),
                        severity=sev, source="semantic",
                        reason=f"Similar a: “{seed_text}” (sim={score_sim:.2f})",
                        page=p, line=l, start=pos, end=pos+len(sent)
                    ))

    # 4) score: suma ponderada con compresión suave
    if not matches:
        score = 0.0
    else:
        raw = 0.0
        for m in matches:
            raw += SEV_W.get(m.severity, 0.35)
        score = math.tanh(raw / 3.0)  # 0..~1

    risk_level = _risk_from_score(score)

    # coherencia: si no hay matches ni anticipaciones => BAJO/0
    if len(matches) == 0 and semantic_hits == 0:
        score = 0.0
        risk_level = "BAJO"

    by_sev = {"HIGH": 0, "MEDIUM": 0, "LOW": 0}
    for m in matches:
        by_sev[m.severity] = by_sev.get(m.severity, 0) + 1

    out = AnalyzeOut(
        risk_level=risk_level,
        score=round(float(score), 4),
        matches=matches,
        summary={
            "total": len(matches),
            "by_severity": by_sev,
            "semantic_used": _EMB_OK,
        }
    )
    return out

# ---------- endpoint ----------
@app.post("/analyze", response_model=AnalyzeOut)
def analyze(payload: AnalyzeIn):
    text = payload.text or ""
    return _analyze(text)