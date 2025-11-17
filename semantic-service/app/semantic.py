from __future__ import annotations
from typing import List, Dict, Any, Optional
import numpy as np
import re

import spacy
from sentence_transformers import SentenceTransformer
from sklearn.metrics.pairwise import cosine_similarity


def clean_text(s: str) -> str:
    s = s.replace("\r", " ").replace("\n", " ")
    s = re.sub(r"\s+", " ", s).strip()
    return s


def clean_ocr_text(s: str) -> str:
    """
    Limpieza fuerte para texto proveniente de imágenes / OCR:
    - Elimina entidades HTML (&quot;, &#8203;, &nbsp;, etc.)
    - Elimina caracteres de control / invisibles
    - Elimina bloques numéricos largos (códigos de OCR)
    - Normaliza espacios
    """
    if not s:
        return ""
    s = re.sub(r"&#\d+;?", " ", s)              # entidades numéricas &#8203;
    s = re.sub(r"&[A-Za-z0-9#]+;", " ", s)      # entidades &quot; &nbsp; ...
    s = re.sub(r"[\x00-\x1F\x7F\xAD]", " ", s)  # caracteres de control

    # 🔥 elimina bloques numéricos largos (6+ dígitos)
    s = re.sub(r"\b\d{6,}\b", " ", s)

    s = re.sub(r"\s+", " ", s)
    return s.strip()


class SemanticIndexer:
    """
    Indexador en memoria con embeddings + filtro por convenio/version.
    - Usa 'paraphrase-multilingual-MiniLM-L12-v2' (bueno para español).
    - spaCy se usa para pequeñas expansiones/normalización de consulta.
    Persistencia: ver storage.py (save/load).
    """
    def __init__(self, model_name: str = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
                 device: str = "cpu"):
        self.model_name = model_name
        self.device = device
        self.encoder: SentenceTransformer = SentenceTransformer(model_name, device=device)
        self.nlp = spacy.load("es_core_news_sm")

        # documentos crudos + metadatos
        self.docs: List[Dict[str, Any]] = []
        # matriz de embeddings (N, D)
        self.embeddings: Optional[np.ndarray] = None

    # ---------- indexado ----------
    def add_docs(self, items: List[Dict[str, Any]]) -> int:
        """
        items: [{id?, convenio_id, version_id, fragmento, meta?}, ...]
        """
        if not items:
            return 0

        # limpiar texto
        for it in items:
            raw = str(it.get("fragmento", ""))
            raw = clean_text(raw)
            raw = clean_ocr_text(raw)
            it["fragmento"] = raw

        texts = [it["fragmento"] for it in items]
        vecs = self._embed(texts)  # (k, d)

        start_len = len(self.docs)
        self.docs.extend(items)

        if self.embeddings is None:
            self.embeddings = vecs
        else:
            self.embeddings = np.vstack([self.embeddings, vecs])

        return len(self.docs) - start_len

    def _embed(self, texts: List[str]) -> np.ndarray:
        return np.asarray(self.encoder.encode(texts, normalize_embeddings=True))  # (n, d)

    # ---------- búsqueda ----------
    def _expand_query(self, q: str) -> str:
        """
        Pequeña expansión semántica:
        - Normaliza y añade entidades (ORG, MISC) detectadas por spaCy.
        - Si aparece 'con ...' o 'convenio con ...', intenta quedarse con el nombre.
        """
        q = q.strip()
        if not q:
            return q

        # caso: "convenio con AGETIC" / "mi convenio con BoA"
        m = re.search(r'(?:convenio\s+con|con)\s+"?([A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9\.\-& ]+)"?', q, flags=re.IGNORECASE)
        extra: List[str] = []
        if m:
            extra.append(m.group(1).strip())

        # NER
        doc = self.nlp(q)
        ents = [e.text for e in doc.ents if e.label_ in {"ORG", "MISC", "PER"}]
        extra.extend(ents)

        expanded = q + (" " + " ".join(set(extra)) if extra else "")
        return expanded

    def search(self, query: str, k: int = 5,
               convenio_id: Optional[int] = None,
               version_id: Optional[int] = None) -> List[Dict[str, Any]]:
        if not self.docs or self.embeddings is None:
            return []

        q_expanded = self._expand_query(query)
        q_vec = self._embed([q_expanded])[0].reshape(1, -1)  # (1, d)

        # filtro por convenio/version (si vienen)
        mask = np.ones(len(self.docs), dtype=bool)
        if convenio_id is not None:
            mask &= np.array([d.get("convenio_id") == convenio_id for d in self.docs])
        if version_id is not None:
            mask &= np.array([d.get("version_id") == version_id for d in self.docs])

        if not mask.any():
            return []

        sims = cosine_similarity(q_vec, self.embeddings[mask])[0]  # (M,)
        idxs = np.where(mask)[0]

        # topk
        topk_rel = min(k, sims.shape[0])
        order = np.argsort(-sims)[:topk_rel]

        results: List[Dict[str, Any]] = []
        for oi in order:
            global_i = idxs[oi]
            d = self.docs[global_i]
            results.append({
                "score": float(sims[oi]),
                "convenio_id": d.get("convenio_id"),
                "version_id": d.get("version_id"),
                "fragmento": d.get("fragmento"),
                "meta": d.get("meta", {}),
            })
        return results

    # ---------- util ----------
    def clear(self):
        self.docs = []
        self.embeddings = None