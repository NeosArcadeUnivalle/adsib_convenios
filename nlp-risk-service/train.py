import argparse
from pathlib import Path
import pandas as pd
from sklearn.preprocessing import LabelEncoder
from sklearn.model_selection import train_test_split
from sklearn.pipeline import make_pipeline, FeatureUnion
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.svm import LinearSVC
from sklearn.calibration import CalibratedClassifierCV
from sklearn.metrics import classification_report
import joblib
 
def _maybe_import_sbert():
    from sentence_transformers import SentenceTransformer
    return SentenceTransformer
 
def read_seed(path):
    df = pd.read_csv(path)
    cols = {c.strip().lower(): c for c in df.columns}
    if not {"text", "severity"} <= set(cols.keys()):
        raise ValueError("El CSV debe tener columnas 'text' y 'severity'.")
    df = df[[cols["text"], cols["severity"]]].dropna()
    df.columns = ["text", "severity"]
    df["text"] = df["text"].astype(str)
    df["severity"] = df["severity"].str.upper().str.strip()
    return df
 
def read_rules(path):
    p = Path(path) if path else None
    if not p or not p.exists():
        return pd.DataFrame(columns=["text", "severity"])
    df = pd.read_csv(p)
    cols = {c.lower(): c for c in df.columns}
    if "text" in cols and "severity" in cols:
        out = df[[cols["text"], cols["severity"]]].dropna()
        out.columns = ["text", "severity"]
        out["severity"] = out["severity"].str.upper().str.strip()
        return out
    return pd.DataFrame(columns=["text", "severity"])
 
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", required=True, help="CSV con columnas text,severity")
    ap.add_argument("--rules", default="", help="CSV débil (opcional)")
    ap.add_argument("--out_dir", default="models")
    ap.add_argument("--backend", choices=["tfidf", "sbert"], default="tfidf")
    ap.add_argument("--embedder", default="paraphrase-multilingual-MiniLM-L12-v2",
                    help="Nombre SBERT (si backend=sbert)")
    # Ajustes finos opcionales
    ap.add_argument("--max_features", type=int, default=12000)
    ap.add_argument("--min_df", type=int, default=1)
    ap.add_argument("--val_size", type=float, default=0.2)
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
 
    X_train, X_val, y_train, y_val = train_test_split(
        X, y_enc, test_size=args.val_size, random_state=42, stratify=y_enc
    )
 
    if args.backend == "tfidf":
        # --- TF-IDF mejorado: palabra (1-3) + carácter (3-5) ---
        word_tfidf = TfidfVectorizer(
            analyzer="word",
            ngram_range=(1, 3),
            max_features=args.max_features,
            min_df=args.min_df,
            sublinear_tf=True,
            lowercase=True,
            strip_accents="unicode"  # quita tildes
        )
        char_tfidf = TfidfVectorizer(
            analyzer="char_wb",
            ngram_range=(3, 5),
            min_df=2,
            lowercase=True,
            strip_accents="unicode"
        )
        features = FeatureUnion([
            ("w", word_tfidf),
            ("c", char_tfidf),
        ])
 
        base = LinearSVC(class_weight="balanced")  # buen rendimiento en texto disperso
        clf = make_pipeline(
            features,
            CalibratedClassifierCV(base, cv=3)  # densidad/calibración de probas
        )
 
        clf.fit(X_train, y_train)
        y_pred = clf.predict(X_val)
        print(classification_report(y_val, y_pred, target_names=list(le.classes_)))
 
        bundle = {
            "clf": clf,
            "label_encoder": le,
            "embedder_name": "tfidf-pipeline"
        }
 
    else:
        SentenceTransformer = _maybe_import_sbert()
        embedder = SentenceTransformer(args.embedder)
        import numpy as np
        E_train = embedder.encode(X_train, convert_to_numpy=True, normalize_embeddings=True)
        E_val   = embedder.encode(X_val,   convert_to_numpy=True, normalize_embeddings=True)
 
        base = LinearSVC(class_weight="balanced")
        clf = CalibratedClassifierCV(base, cv=3)
        clf.fit(E_train, y_train)
        y_pred = clf.predict(E_val)
        print(classification_report(y_val, y_pred, target_names=list(le.classes_)))
 
        bundle = {
            "clf": clf,
            "label_encoder": le,
            "embedder_name": args.embedder
        }
 
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    joblib.dump(bundle, out_dir / "risk_head.joblib")
    print(f"\nOK -> modelo guardado en {out_dir/'risk_head.joblib'}")
    print("Clases:", list(le.classes_))
 
if __name__ == "__main__":
    main()