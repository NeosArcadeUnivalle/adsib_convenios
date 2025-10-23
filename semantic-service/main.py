from fastapi import FastAPI
from pydantic import BaseModel
from typing import List, Optional
import uvicorn

import spacy
from sentence_transformers import SentenceTransformer, util
import torch

app = FastAPI(title="semantic-service", version="1.1")

nlp = spacy.load("es_core_news_sm")
embedder = SentenceTransformer("sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2")

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
        return QAResponse(answer="No recibí contenido para analizar.", used=[])

    q = req.question.strip()
    q_emb = embedder.encode(q, convert_to_tensor=True, normalize_embeddings=True)

    # 1) Elegir el mejor item (por documento)
    best_item = None
    best_score = -1.0
    for it in req.items:
        frag = it.fragmento.strip()
        if not frag:
            continue
        emb = embedder.encode(frag, convert_to_tensor=True, normalize_embeddings=True)
        score = float(util.cos_sim(q_emb, emb)[0][0])
        if score > best_score:
            best_score = score
            best_item = it

    if not best_item:
        return QAResponse(answer="No pude relacionar la pregunta con el contenido.", used=[])

    # 2) Dentro del fragmento ganador, elegir oraciones más relevantes
    doc = nlp(best_item.fragmento[:60000])
    sents = [s.text.strip() for s in doc.sents if s.text.strip()]
    if not sents:
        return QAResponse(answer="No hay oraciones analizables en el texto.", used=[best_item])

    # Embeddings por oraciones
    sent_embs = embedder.encode(sents, convert_to_tensor=True, normalize_embeddings=True)
    sims = util.cos_sim(q_emb, sent_embs)[0]
    topk = min(req.top_k, len(sents))
    best_idx = torch.topk(sims, k=topk).indices.tolist()
    best_idx.sort()  # mantener orden textual

    chosen = [sents[i] for i in best_idx]
    # 3) Componer respuesta corta
    answer = " ".join(chosen)
    if len(answer) > 1200:
        answer = answer[:1200] + " …"

    return QAResponse(answer=answer, used=[best_item])

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8010)