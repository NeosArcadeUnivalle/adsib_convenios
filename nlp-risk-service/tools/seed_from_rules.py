# tools/seed_from_rules.py
import os, json, csv, sys
from pathlib import Path

# añade ../ al PYTHONPATH
sys.path.append(str(Path(__file__).resolve().parents[1]))

from app.main import _analyze  # usa analizador actual (v1.4)

CORPUS_DIR = Path("corpus")
OUT_DIR = Path("app/data")
OUT_DIR.mkdir(exist_ok=True, parents=True)
OUT_CSV = OUT_DIR / "dataset_rules.csv"


def main():
    rows = []
    for f in sorted(CORPUS_DIR.glob("*.txt")):
        text = f.read_text(encoding="utf-8", errors="ignore")
        res = _analyze(text)
        for m in res.matches:
            frag = (
                text[m.start : m.end]
                if (m.start is not None and m.end is not None)
                else m.token
            )
            frag = (frag or "").strip()
            if not frag:
                continue
            rows.append(
                {
                    "file": f.name,
                    "text": frag,
                    "severity": m.severity,
                    "source": m.source,
                    "reason": m.reason,
                    "page": m.page or "",
                    "line": m.line or "",
                }
            )

    with OUT_CSV.open("w", newline="", encoding="utf-8") as fh:
        fieldnames = [
            "file",
            "text",
            "severity",
            "source",
            "reason",
            "page",
            "line",
        ]
        w = csv.DictWriter(fh, fieldnames=fieldnames)
        w.writeheader()
        for r in rows:
            w.writerow(r)

    print(f"OK -> {len(rows)} ejemplos guardados en {OUT_CSV}")


if __name__ == "__main__":
    main()