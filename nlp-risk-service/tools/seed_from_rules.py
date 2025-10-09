# tools/seed_from_rules.py
import os, json, csv, sys
from pathlib import Path

# Importa el analizador directamente
sys.path.append(str(Path(__file__).resolve().parents[1]))  # añade ../ al PYTHONPATH
from app.main import _analyze  # usa tu mismo analizador v1.2/1.3

CORPUS_DIR = Path("corpus")
OUT_DIR    = Path("data")
OUT_DIR.mkdir(exist_ok=True, parents=True)
OUT_CSV    = OUT_DIR / "dataset_rules.csv"

def main():
    rows = []
    for f in sorted(CORPUS_DIR.glob("*.txt")):
        text = f.read_text(encoding="utf-8", errors="ignore")
        res = _analyze(text)  # devuelve matches con page/line/start/end/severity/source
        for m in res.matches:
            # recorta el fragmento; si no hay offsets, cae al token
            frag = text[m.start:m.end] if (m.start is not None and m.end is not None) else m.token
            frag = frag.strip()
            if not frag:
                continue
            rows.append({
                "file": f.name,
                "text": frag,
                "severity": m.severity,          # HIGH|MEDIUM|LOW
                "source": m.source,              # keyword|pattern|semantic
                "reason": m.reason,
                "page": m.page or "",
                "line": m.line or "",
            })

    # guarda CSV
    with OUT_CSV.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()) if rows else
                           ["file","text","severity","source","reason","page","line"])
        w.writeheader()
        for r in rows:
            w.writerow(r)

    print(f"OK -> {len(rows)} ejemplos guardados en {OUT_CSV}")

if __name__ == "__main__":
    main()