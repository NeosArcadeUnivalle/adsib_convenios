# app/db.py
import os
from contextlib import contextmanager

from dotenv import load_dotenv
import psycopg2  # type: ignore
from psycopg2.extras import RealDictCursor  # type: ignore

# Carga variables de entorno desde .env (en la carpeta raíz nlp-risk-service)
load_dotenv()


def get_db_connection():
    """
    Devuelve una conexión a PostgreSQL usando las mismas credenciales
    que tu backend Laravel (mismas variables de entorno, solo lectura/escritura básica).
    """
    conn = psycopg2.connect(
        host=os.getenv("DB_HOST", "127.0.0.1"),
        port=int(os.getenv("DB_PORT", "5432")),
        dbname=os.getenv("DB_DATABASE", os.getenv("DB_NAME", "adsib_db")),
        user=os.getenv("DB_USERNAME", os.getenv("DB_USER", "postgres")),
        password=os.getenv("DB_PASSWORD", os.getenv("DB_PASS", "ne3o0s5.")),
    )
    return conn


@contextmanager
def db_cursor(dict_cursor: bool = True):
    """
    Context manager para obtener un cursor y cerrar conexión automáticamente.

    Uso:
        with db_cursor() as cur:
            cur.execute("SELECT ...")
            rows = cur.fetchall()
    """
    conn = get_db_connection()
    try:
        cur = conn.cursor(cursor_factory=RealDictCursor if dict_cursor else None)
        yield cur
        conn.commit()
    finally:
        conn.close()


def fetch_riesgo_keywords(active_only: bool = True):
    """
    Lee las PALABRAS CLAVE de la tabla real:

        riesgo_keywords (id, texto, severity, reason, activo, created_at, updated_at)

    Devuelve una lista de dicts:
        {
          "id": ...,
          "texto": ...,
          "severity": ...,
          "reason": ...,
          "activo": ...
        }
    """
    sql = """
        SELECT id, texto, severity, reason, activo
        FROM riesgo_keywords
    """
    params = []
    if active_only:
        sql += " WHERE activo = TRUE"

    with db_cursor(dict_cursor=True) as cur:
        cur.execute(sql, params)
        rows = cur.fetchall()

    return rows or []