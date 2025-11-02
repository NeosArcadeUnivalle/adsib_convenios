import React, { useEffect, useState, useContext } from "react";
import { View, Text, TextInput, FlatList, Pressable } from "react-native";
import { get } from "../api";
import { AuthCtx } from "../auth";

export default function ConveniosListScreen({ navigation }) {
  const auth = useContext(AuthCtx) || {};
  const logout = typeof auth.logout === "function" ? auth.logout : () => {};

  const [data, setData] = useState([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    (async () => {
      try {
        setErr("");
        const res = await get("/convenios", { params: { per_page: 100 } });
        const rows = Array.isArray(res) ? res : (res?.data || []);
        setData(rows);
      } catch (e) {
        const status = e?.response?.status;
        if (status === 401) {
          setErr("Sesión expirada. Inicia sesión nuevamente.");
          logout();
        } else {
          setErr("No se pudieron cargar los convenios.");
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filtered = data.filter((c) =>
    (c.titulo || "").toLowerCase().includes(q.trim().toLowerCase())
  );

  const renderItem = ({ item }) => (
    <Pressable
      onPress={() => navigation.navigate("Detalle", { id: item.id, title: item.titulo })}
      style={({ pressed }) => ({
        backgroundColor: "#12151b",
        borderColor: "#1f2937",
        borderWidth: 1,
        borderRadius: 12,
        padding: 12,
        marginBottom: 10,
        transform: [{ scale: pressed ? 0.99 : 1 }],
      })}
    >
      <Text style={{ color: "#f1f5f9", fontWeight: "800", fontSize: 16 }} numberOfLines={2}>
        {item.titulo}
      </Text>
      <Text style={{ color: "#9ca3af", marginTop: 4 }} numberOfLines={2}>
        {item.descripcion || "—"}
      </Text>
      <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
        <Chip text={item.estado || "—"} />
      </View>
    </Pressable>
  );

  return (
    <View style={{ flex: 1, backgroundColor: "#0b0c0f", padding: 16 }}>
      <TextInput
        placeholder="Buscar por nombre de convenio…"
        placeholderTextColor="#6b7280"
        style={{
          backgroundColor: "#0b0c0f",
          borderColor: "#1f2937",
          borderWidth: 1,
          color: "#e5e7eb",
          paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, marginBottom: 12,
        }}
        value={q}
        onChangeText={setQ}
      />

      {err ? <Text style={{ color: "#ef4444", marginBottom: 8 }}>{err}</Text> : null}

      {loading ? (
        <Text style={{ color: "#9ca3af" }}>Cargando…</Text>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(it) => String(it.id)}
          renderItem={renderItem}
          contentContainerStyle={{ paddingBottom: 16 }}
          ListEmptyComponent={<Text style={{ color: "#9ca3af" }}>Sin resultados</Text>}
        />
      )}
    </View>
  );
}

function Chip({ text }) {
  const color = text === "CERRADO" ? "#10b981" : text === "VENCIDO" ? "#ef4444" : "#f59e0b";
  return (
    <View style={{ backgroundColor: color, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 }}>
      <Text style={{ color: "#0b1220", fontWeight: "900" }}>{text}</Text>
    </View>
  );
}