from fastapi import FastAPI
from pydantic import BaseModel
from typing import List, Optional
import uvicorn
import re

import spacy
from sentence_transformers import SentenceTransformer, util
import torch

app = FastAPI(title="semantic-service", version="1.1")

nlp = spacy.load("es_core_news_sm")
embedder = SentenceTransformer("sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2")


def clean_ocr_text(s: str) -> str:
    """
    Limpieza fuerte para respuestas / fragmentos:
    - Elimina entidades HTML (&quot;, &#8203;, etc.)
    - Elimina caracteres de control
    - Elimina bloques numéricos largos (códigos de OCR)
    - Normaliza espacios
    """
    if not s:
        return ""
    s = re.sub(r"&#\d+;?", " ", s)
    s = re.sub(r"&[A-Za-z0-9#]+;", " ", s)
    s = re.sub(r"[\x00-\x1F\x7F\xAD]", " ", s)

    # 🔥 elimina bloques numéricos largos (6+ dígitos)
    s = re.sub(r"\b\d{6,}\b", " ", s)

    s = re.sub(r"\s+", " ", s)
    return s.strip()


class QAItem(BaseModel):
    convenio_id: int
    version_id: int
    fragmento: str
    tag: Optional[str] = None


class QARequest(BaseModel):
    question: str
    items: List[QAItem]
    top_k: int = 5


class QAResponse(BaseModel):
    answer: str
    used: List[QAItem]


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/qa", response_model=QAResponse)
def qa(req: QARequest):
    if not req.items:
        return QAResponse(
            answer="No tengo una respuesta exacta para esa consulta, porque no recibí contenido para analizar.",
            used=[],
        )

    q = req.question.strip()
    if not q:
        return QAResponse(
            answer="No tengo una respuesta exacta para esa consulta, la pregunta llegó vacía.",
            used=[],
        )

    q_emb = embedder.encode(q, convert_to_tensor=True, normalize_embeddings=True)

    # 1) Elegir el mejor item (por documento)
    best_item: Optional[QAItem] = None
    best_score: float = -1.0
    for it in req.items:
        frag = clean_ocr_text(it.fragmento or "")
        if not frag:
            continue
        emb = embedder.encode(frag, convert_to_tensor=True, normalize_embeddings=True)
        score = float(util.cos_sim(q_emb, emb)[0][0])
        if score > best_score:
            best_score = score
            best_item = it

    if not best_item:
        return QAResponse(
            answer="No tengo una respuesta exacta para esa consulta en el texto analizado.",
            used=[],
        )

    # umbral: si la similitud es muy baja, mejor responder que no hay respuesta clara
    if best_score < 0.30:
        return QAResponse(
            answer="No tengo una respuesta exacta para esa consulta en el texto disponible.",
            used=[best_item],
        )

    # 2) Dentro del fragmento ganador, elegir oraciones más relevantes
    frag_clean = clean_ocr_text(best_item.fragmento or "")
    doc = nlp(frag_clean[:60000])
    sents = [s.text.strip() for s in doc.sents if s.text.strip()]
    if not sents:
        return QAResponse(
            answer="No tengo una respuesta exacta para esa consulta porque el texto del convenio no se pudo dividir en oraciones útiles.",
            used=[best_item],
        )

    # Embeddings por oraciones
    sent_embs = embedder.encode(sents, convert_to_tensor=True, normalize_embeddings=True)
    sims = util.cos_sim(q_emb, sent_embs)[0]
    topk = min(req.top_k, len(sents))
    best_idx = torch.topk(sims, k=topk).indices.tolist()
    best_idx.sort()  # mantener orden textual

    chosen = [sents[i] for i in best_idx]
    answer = " ".join(chosen)
    MAX_OUT = 10000
    if len(answer) > MAX_OUT:
        answer = answer[:MAX_OUT] + " …"

    answer = clean_ocr_text(answer)

    if not answer or len(answer) < 10:
        answer = "No tengo una respuesta exacta para esa consulta en el texto analizado."

    return QAResponse(answer=answer, used=[best_item])


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8010)