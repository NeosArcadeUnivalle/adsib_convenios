from __future__ import annotations
from typing import List, Optional
from fastapi import FastAPI
from pydantic import BaseModel, Field

from .semantic import SemanticIndexer
from .storage import save_index, load_index

app = FastAPI(title="Semantic Service", version="0.1.0")

# indexador global
indexer: SemanticIndexer = SemanticIndexer()


class DocIn(BaseModel):
    convenio_id: int
    version_id: int
    fragmento: str
    meta: dict = Field(default_factory=dict)


class IndexIn(BaseModel):
    items: List[DocIn]


class SearchIn(BaseModel):
    query: str
    k: int = 5
    convenio_id: Optional[int] = None
    version_id: Optional[int] = None


@app.on_event("startup")
def _startup():
    # intenta cargar si existe
    docs, emb = load_index()
    if docs:
        indexer.docs = docs
        indexer.embeddings = emb
        print(f"[semantic-service] índice cargado: {len(docs)} fragmentos.")
    else:
        print("[semantic-service] índice vacío.")


@app.get("/health")
def health():
    return {"ok": True, "docs": len(indexer.docs)}


@app.post("/index")
def index(payload: IndexIn):
    added = indexer.add_docs([d.model_dump() for d in payload.items])
    # persistimos
    save_index(indexer.docs, indexer.embeddings)
    return {"ok": True, "added": added, "total": len(indexer.docs)}


@app.post("/search")
def search(payload: SearchIn):
    res = indexer.search(payload.query, k=payload.k,
                         convenio_id=payload.convenio_id,
                         version_id=payload.version_id)
    return {"ok": True, "results": res}