# app/_init_.py
"""
Paquete del servicio NLP de riesgo.

Aquí solo exponemos utilidades de conexión a BD para uso interno.
"""

from .db import get_db_connection, fetch_riesgo_keywords

_all_ = ["get_db_connection", "fetch_riesgo_keywords"]