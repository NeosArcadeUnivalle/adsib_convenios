# app/main.py  — v1.5 (usa tabla riesgo_keywords en cada análisis)
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
import re
import unicodedata
import math
import os
from pathlib import Path

import joblib
import numpy as np
import spacy

from app.db import fetch_riesgo_keywords

# ====== (opcional) embeddings para fallback semántico ======
try:
    from sentence_transformers import SentenceTransformer, util  # type: ignore

    _EMB_OK = True
    _fallback_embedder = SentenceTransformer(
        "paraphrase-multilingual-MiniLM-L12-v2"
    )
except Exception:
    _EMB_OK = False
    _fallback_embedder = None

app = FastAPI(title="NLP Risk Service", version="1.5")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------- modelos de IO ----------
class AnalyzeIn(BaseModel):
    text: str


class Match(BaseModel):
    token: str
    severity: str  # HIGH | MEDIUM | LOW
    source: str  # keyword | pattern | semantic
    reason: str
    page: Optional[int] = None
    line: Optional[int] = None
    start: Optional[int] = None
    end: Optional[int] = None


class AnalyzeOut(BaseModel):
    risk_level: str  # ALTO | MEDIO | BAJO
    score: float  # 0..1
    matches: List[Match]
    summary: Dict[str, Any]


# ---------- utilidades ----------
def _norm(s: str) -> str:
    s = unicodedata.normalize("NFKC", s or "")
    s = s.replace("\r", "")
    return s


_PAGE_RE = re.compile(r"(p[aá]gina|page)\s+(\d+)", re.I)


def _index_lines(text: str):
    """Devuelve lista de líneas con (page,line,start,end,text)."""
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
        out.append(
            {
                "idx": i + 1,
                "page": page,
                "line": i + 1,
                "start": start,
                "end": end,
                "text": line,
            }
        )
        start = end + 1
    return out


def _find_occurrences(hay: str, needle: str):
    """Posiciones start/end de coincidencias exactas (case-insensitive)."""
    out = []
    if not needle.strip():
        return out
    lo_hay, lo_needle = hay.lower(), needle.lower()
    idx, guard = 0, 0
    while True:
        pos = lo_hay.find(lo_needle, idx)
        if pos == -1 or guard > 10000:
            break
        out.append((pos, pos + len(needle)))
        idx = pos + len(needle)
        guard += 1
    return out


def _char_to_page_line(char_pos: int, index_lines):
    """De un offset absoluto devuelve (page, line) usando el índice."""
    if char_pos is None:
        return None, None
    for item in index_lines:
        if item["start"] <= char_pos <= item["end"]:
            return item["page"], item["line"]
    if index_lines:
        return index_lines[-1]["page"], index_lines[-1]["line"]
    return None, None


# ---------- PATRONES regex (siguen en código) ----------
PATTERNS = [
    (
        re.compile(r"(precio).{0,10}(preferencial|preferentes?)", re.I),
        "HIGH",
        "Referencia explícita a 'precio preferencial'.",
    ),
    (
        re.compile(r"(cantidad|orden).{0,12}m[ií]nima", re.I),
        "MEDIUM",
        "Condición de 'cantidad mínima' o similar.",
    ),
    (
        re.compile(r"mayor\s+cantidad\s+de\s+reemisiones", re.I),
        "HIGH",
        "Incremento de reemisiones.",
    ),
]


# Fallback semántico si NO hay clasificador entrenado
ARCHETYPES = [
    ("HIGH", "El proveedor tendrá precios preferenciales para el contratante."),
    ("HIGH", "Se permite otorgar descuentos exclusivos a una de las partes."),
    (
        "MEDIUM",
        "Se requiere una cantidad mínima de compra para acceder al servicio.",
    ),
    (
        "MEDIUM",
        "Se autoriza mayor cantidad de reemisiones respecto al límite normal.",
    ),
    ("LOW", "El convenio queda sujeto al límite presupuestario asignado."),
]

SEV_W = {"HIGH": 1.0, "MEDIUM": 0.6, "LOW": 0.35}


def _risk_from_score(score: float) -> str:
    if score >= 0.66:
        return "ALTO"
    if score >= 0.33:
        return "MEDIO"
    return "BAJO"


# ---------- carga de modelo entrenado (si existe) ----------
MODEL_DIR = Path(os.getenv("RISK_MODEL_DIR", "models"))
MODEL_HEAD_PATH = MODEL_DIR / "risk_head.joblib"

_head = None  # clasificador sklearn (o pipeline TF-IDF)
_head_le = None  # label encoder
_head_embedder = None  # SentenceTransformer si el modelo NO es TF-IDF
_head_embedder_name = None


def _load_head() -> bool:
    """Carga el clasificador entrenado si está disponible."""
    global _head, _head_le, _head_embedder, _head_embedder_name
    if _head is not None:
        return True
    if not MODEL_HEAD_PATH.exists():
        return False
    bundle = joblib.load(MODEL_HEAD_PATH)
    _head = bundle["clf"]
    _head_le = bundle["label_encoder"]
    _head_embedder_name = bundle.get("embedder_name", "")
    # Si el embedder es TF-IDF pipeline, no necesitamos SentenceTransformer
    if str(_head_embedder_name).startswith("tfidf"):
        _head_embedder = None
        return True
    # Para SBERT, intentamos cargar el mismo modelo usado en entrenamiento
    try:
        from sentence_transformers import SentenceTransformer as _ST  # type: ignore

        _head_embedder = _ST(
            _head_embedder_name or "paraphrase-multilingual-MiniLM-L12-v2"
        )
        return True
    except Exception:
        _head_embedder = None
        return True


# ---------- análisis ----------
def _analyze(text: str) -> AnalyzeOut:
    text = _norm(text)
    if not text.strip():
        raise HTTPException(status_code=400, detail="Texto vacío")

    idx = _index_lines(text)
    matches: List[Match] = []

    # 1) Palabras clave desde riesgo_keywords (siempre fresco desde la BD)
    rows = fetch_riesgo_keywords(active_only=True)
    keywords: Dict[str, Dict[str, str]] = {}
    for r in rows:
        tok = (r.get("texto") or "").strip()
        if not tok:
            continue
        sev = (r.get("severity") or "").upper().strip() or "MEDIUM"
        reason = (r.get("reason") or "").strip()
        keywords[tok] = {"severity": sev, "reason": reason}

    for tok, meta in keywords.items():
        sev = meta["severity"]
        why = meta["reason"]
        for start, end in _find_occurrences(text, tok):
            p, l = _char_to_page_line(start, idx)
            matches.append(
                Match(
                    token=tok,
                    severity=sev,
                    source="keyword",
                    reason=why,
                    page=p,
                    line=l,
                    start=start,
                    end=end,
                )
            )

    # 2) patrones regex
    for rx, sev, why in PATTERNS:
        for m in rx.finditer(text):
            start, end = m.span()
            tok = m.group(0)
            p, l = _char_to_page_line(start, idx)
            matches.append(
                Match(
                    token=tok,
                    severity=sev,
                    source="pattern",
                    reason=why,
                    page=p,
                    line=l,
                    start=start,
                    end=end,
                )
            )

    # 3) modelo entrenado o fallback semántico
    semantic_hits = 0
    nlp = spacy.blank("es")
    nlp.add_pipe("sentencizer")
    sentences = [s.text.strip() for s in nlp(text).sents if s.text.strip()]

    if _load_head() and sentences and _head is not None and _head_le is not None:
        classes = list(_head_le.classes_)
        thr = {"HIGH": 0.60, "MEDIUM": 0.55, "LOW": 0.70}

        if (_head_embedder is None) and str(_head_embedder_name).startswith("tfidf"):
            try:
                proba = _head.predict_proba(sentences)
            except Exception:
                proba = None
        else:
            proba = None
            if _head_embedder is not None:
                S = _head_embedder.encode(
                    sentences, convert_to_numpy=True, normalize_embeddings=True
                )
                proba = _head.predict_proba(S)

        if proba is not None:
            for i, sent in enumerate(sentences):
                j = int(np.argmax(proba[i]))
                sev = classes[j]
                pconf = float(proba[i][j])
                if pconf >= thr.get(sev, 0.6):
                    semantic_hits += 1
                    pos = text.find(sent)
                    pos = max(0, pos)
                    pnum, lnum = _char_to_page_line(pos, idx)
                    matches.append(
                        Match(
                            token=sent[:100] + ("…" if len(sent) > 100 else ""),
                            severity=sev,
                            source="semantic",
                            reason=f"Modelo entrenado (p={pconf:.2f})",
                            page=pnum,
                            line=lnum,
                            start=pos,
                            end=pos + len(sent),
                        )
                    )

    elif _EMB_OK and sentences:
        S = _fallback_embedder.encode(
            sentences, convert_to_numpy=True, normalize_embeddings=True
        )
        T = _fallback_embedder.encode(
            [t for _, t in ARCHETYPES],
            convert_to_numpy=True,
            normalize_embeddings=True,
        )
        sim = S @ T.T  # coseno normalizado
        for i, sent in enumerate(sentences):
            best_j = int(np.argmax(sim[i]))
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
                pos = max(0, text.find(sent))
                pnum, lnum = _char_to_page_line(pos, idx)
                matches.append(
                    Match(
                        token=sent[:100] + ("…" if len(sent) > 100 else ""),
                        severity=sev,
                        source="semantic",
                        reason=f"Similar a arquetipo (sim={score_sim:.2f})",
                        page=pnum,
                        line=lnum,
                        start=pos,
                        end=pos + len(sent),
                    )
                )

    # 4) score total
    score = 0.0
    if matches:
        raw = sum(
            {"HIGH": 1.0, "MEDIUM": 0.6, "LOW": 0.35}.get(m.severity, 0.35)
            for m in matches
        )
        score = math.tanh(raw / 3.0)

    risk_level = _risk_from_score(score)
    if len(matches) == 0 and semantic_hits == 0:
        score, risk_level = 0.0, "BAJO"

    by_sev = {"HIGH": 0, "MEDIUM": 0, "LOW": 0}
    for m in matches:
        by_sev[m.severity] = by_sev.get(m.severity, 0) + 1

    return AnalyzeOut(
        risk_level=risk_level,
        score=round(float(score), 4),
        matches=matches,
        summary={
            "total": len(matches),
            "by_severity": by_sev,
            "semantic_used": bool(_head is not None),
            "model_embedder": _head_embedder_name
            or ("fallback" if _EMB_OK else None),
            "keywords_db": len(keywords),
            "keywords_table": "riesgo_keywords",
        },
    )


# ---------- endpoints ----------
@app.post("/analyze", response_model=AnalyzeOut)
def analyze(payload: AnalyzeIn):
    return _analyze(payload.text or "")


@app.get("/health")
def health():
    loaded = _load_head()
    # Contamos keywords realmente en BD (no cache)
    try:
        kw_rows = fetch_riesgo_keywords(active_only=True)
        kw_count = len(kw_rows)
    except Exception:
        kw_count = 0

    return {
        "ok": True,
        "version": "1.5",
        "model_loaded": loaded,
        "model_dir": str(MODEL_DIR),
        "model_embedder": _head_embedder_name,
        "embeddings_fallback_ok": bool(_EMB_OK),
        "keywords_db": kw_count,
        "keywords_table": "riesgo_keywords",
        "patterns": len(PATTERNS),
    }


@app.get("/")
def root():
    return {"ok": True, "message": "NLP Risk Service v1.5"}