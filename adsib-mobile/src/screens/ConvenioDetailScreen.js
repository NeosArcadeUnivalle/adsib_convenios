import React, { useEffect, useLayoutEffect, useState } from "react";
import { View, Text, FlatList } from "react-native";
import { get } from "../api";

export default function ConvenioDetailScreen({ route, navigation }) {
  const { id, title } = route.params;
  const [c, setC] = useState(null);
  const [versiones, setVersiones] = useState([]);

  useLayoutEffect(() => {
    if (title) navigation.setOptions({ title });
  }, [title]);

  useEffect(() => {
    (async () => {
      try {
        const conven = await get(`/convenios/${id}`);
        // Soporta {data: {...}} o la entidad directa
        const ent = conven?.data || conven;
        setC(ent);
        const vs = await get(`/convenios/${id}/versiones`, { params: { per_page: 100 } });
        const rows = Array.isArray(vs) ? vs : (vs?.data || []);
        setVersiones(rows);
      } catch {}
    })();
  }, [id]);

  return (
    <View style={{ flex: 1, backgroundColor: "#0b0c0f", padding: 16 }}>
      {!c ? (
        <Text style={{ color: "#9ca3af" }}>Cargando…</Text>
      ) : (
        <>
          <View style={{ backgroundColor: "#12151b", borderColor: "#1f2937", borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 12 }}>
            <Text style={{ color: "#f1f5f9", fontWeight: "900", fontSize: 18, marginBottom: 6 }}>{c.titulo}</Text>
            <Text style={{ color: "#9ca3af" }}>{c.descripcion || "—"}</Text>
            <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
              <Meta label="Estado" value={c.estado || "—"} />
              <Meta label="Firma" value={fmtDate(c.fecha_firma)} />
              <Meta label="Vence" value={fmtDate(c.fecha_vencimiento)} />
            </View>
          </View>

          <Text style={{ color: "#e5e7eb", fontWeight: "800", marginBottom: 8 }}>
            Versiones ({versiones.length})
          </Text>

          <FlatList
            data={versiones}
            keyExtractor={(it) => String(it.id)}
            renderItem={({ item }) => (
              <View style={{
                backgroundColor: "#12151b", borderColor: "#1f2937", borderWidth: 1,
                borderRadius: 12, padding: 12, marginBottom: 10
              }}>
                <Text style={{ color: "#f1f5f9", fontWeight: "800" }}>
                  v{item.numero_version} • {fmtDate(item.fecha_version)}
                </Text>
                <Text style={{ color: "#9ca3af", marginTop: 4 }}>
                  {item.archivo_nombre_original || "archivo"}
                </Text>
                <Text style={{ color: "#cbd5e1", marginTop: 4 }}>
                  {item.observaciones || "—"}
                </Text>
              </View>
            )}
            contentContainerStyle={{ paddingBottom: 16 }}
          />
        </>
      )}
    </View>
  );
}

function Meta({ label, value }) {
  return (
    <View style={{ backgroundColor: "#0b0c0f", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10 }}>
      <Text style={{ color: "#9ca3af", fontSize: 12 }}>{label}</Text>
      <Text style={{ color: "#f3f4f6", fontWeight: "800" }}>{value}</Text>
    </View>
  );
}

function fmtDate(s) {
  if (!s) return "—";
  try {
    const d = new Date(s);
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  } catch { return "—"; }
}