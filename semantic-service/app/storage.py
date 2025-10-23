from __future__ import annotations
from typing import List, Dict, Any
import os, json
import numpy as np

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")
DOCS_FP = os.path.join(DATA_DIR, "index.jsonl")
EMB_FP  = os.path.join(DATA_DIR, "embeddings.npy")


def ensure_data_dir():
    os.makedirs(DATA_DIR, exist_ok=True)


def save_index(docs: List[Dict[str, Any]], embeddings):
    ensure_data_dir()
    with open(DOCS_FP, "w", encoding="utf-8") as f:
        for d in docs:
            f.write(json.dumps(d, ensure_ascii=False) + "\n")
    if embeddings is not None:
        np.save(EMB_FP, embeddings)


def load_index():
    ensure_data_dir()
    docs: List[Dict[str, Any]] = []
    if os.path.isfile(DOCS_FP):
        with open(DOCS_FP, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    docs.append(json.loads(line))

    embeddings = None
    if os.path.isfile(EMB_FP):
        embeddings = np.load(EMB_FP)

    return docs, embeddings