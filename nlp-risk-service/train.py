# train.py  (backend por defecto: tfidf)
import argparse, os, json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.preprocessing import LabelEncoder
from sklearn.model_selection import train_test_split
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics import classification_report
import joblib

# Opcional SBERT si eliges backend sbert
def _maybe_import_sbert():
    from sentence_transformers import SentenceTransformer
    return SentenceTransformer

def read_seed(path):
    df = pd.read_csv(path)
    cols = set(c.strip().lower() for c in df.columns)
    if not {"text","severity"} <= cols:
        raise ValueError("El CSV debe tener columnas 'text' y 'severity'.")
    df = df[["text","severity"]].dropna()
    df["text"] = df["text"].astype(str)
    df["severity"] = df["severity"].str.upper().str.strip()
    return df

def read_rules(path):
    if not path or not Path(path).exists():
        return pd.DataFrame(columns=["text","severity"])
    df = pd.read_csv(path)
    # dataset_rules.csv venía con muchas columnas; nos quedamos con text y severity si existen
    cols = {c.lower():c for c in df.columns}
    if "text" in cols and "severity" in cols:
        out = df[[cols["text"], cols["severity"]]].dropna()
        out.columns = ["text","severity"]
        out["severity"] = out["severity"].str.upper().str.strip()
        return out
    return pd.DataFrame(columns=["text","severity"])

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", required=True, help="CSV con columnas text,severity")
    ap.add_argument("--rules", default="app/data/dataset_rules.csv", help="CSV débil (opcional)")
    ap.add_argument("--out_dir", default="models")
    ap.add_argument("--backend", choices=["tfidf","sbert"], default="tfidf")
    ap.add_argument("--embedder", default="paraphrase-multilingual-MiniLM-L12-v2",
                    help="Nombre SBERT (si backend=sbert)")
    args = ap.parse_args()

    df = read_seed(args.seed)
    weak = read_rules(args.rules)
    data = pd.concat([df, weak], ignore_index=True)
    if len(data) < 10:
        print(f"Advertencia: dataset pequeño ({len(data)} filas)")
    X = data["text"].tolist()
    y = data["severity"].tolist()

    le = LabelEncoder()
    y_enc = le.fit_transform(y)

    X_train, X_val, y_train, y_val = train_test_split(X, y_enc, test_size=0.2, random_state=42, stratify=y_enc)

    if args.backend == "tfidf":
        # Pipeline completo: TF-IDF (1-2-gramas) + Regresión Logística
        clf = make_pipeline(
            TfidfVectorizer(ngram_range=(1,2), max_features=8000, min_df=1),
            LogisticRegression(max_iter=2000, class_weight="balanced", n_jobs=None)
        )
        clf.fit(X_train, y_train)
        y_pred = clf.predict(X_val)
        print(classification_report(y_val, y_pred, target_names=list(le.classes_)))
        bundle = {
            "clf": clf,
            "label_encoder": le,
            "embedder_name": "tfidf-pipeline"  # <- importante para la API
        }

    else:
        # SBERT (solo si tienes HuggingFace funcionando)
        SentenceTransformer = _maybe_import_sbert()
        embedder = SentenceTransformer(args.embedder)
        E_train = embedder.encode(X_train, convert_to_numpy=True, normalize_embeddings=True)
        E_val   = embedder.encode(X_val,   convert_to_numpy=True, normalize_embeddings=True)
        clf = LogisticRegression(max_iter=2000, class_weight="balanced")
        clf.fit(E_train, y_train)
        y_pred = clf.predict(E_val)
        print(classification_report(y_val, y_pred, target_names=list(le.classes_)))
        bundle = {
            "clf": clf,
            "label_encoder": le,
            "embedder_name": args.embedder  # la API cargará este modelo SBERT
        }

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    joblib.dump(bundle, out_dir / "risk_head.joblib")
    print(f"\nOK -> modelo guardado en {out_dir/'risk_head.joblib'}")
    print("Clases:", list(le.classes_))

if __name__ == "__main__":
    main()