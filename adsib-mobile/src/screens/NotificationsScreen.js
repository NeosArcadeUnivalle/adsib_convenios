// NotificationsScreen.js
import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  Pressable,
  ScrollView,
} from "react-native";
import { get } from "../api";

export default function NotificationsScreen({ navigation }) {
  const [high, setHigh] = useState([]);
  const [medium, setMedium] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      setErr("");
      setLoading(true);
      const res = await get("/notificaciones/alertas");
      const data = res?.data || res || {};
      const hi = Array.isArray(data.high) ? data.high : data.altas || [];
      const mid = Array.isArray(data.medium) ? data.medium : data.medias || [];
      setHigh(hi);
      setMedium(mid);
    } catch (e) {
      setErr("No se pudieron obtener las notificaciones.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const formatDate = (s) => {
    if (!s) return "—";
    try {
      return new Date(s).toLocaleDateString("es-BO");
    } catch {
      return s;
    }
  };

  const renderItem = (item, nivel) => (
    <View
      key={`${item.convenio_id}-${item.id ?? "s"}`}
      style={{
        borderColor: "#1f2937",
        borderWidth: 1,
        borderRadius: 10,
        padding: 12,
        marginBottom: 10,
        backgroundColor: "#020617",
      }}
    >
      <Text
        style={{
          color: "#e5e7eb",
          fontSize: 15,
          fontWeight: "800",
          marginBottom: 4,
        }}
      >
        {item.convenio_titulo || `Convenio #${item.convenio_id}`}
      </Text>

      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 6 }}>
        <Badge
          text={nivel === "ALTO" ? "ALTO" : "MEDIO"}
          type={nivel === "ALTO" ? "high" : "medium"}
        />
        {item.estado ? (
          <Text
            style={{
              color: "#9ca3af",
              marginLeft: 8,
              fontSize: 12,
            }}
          >
            Estado: {item.estado}
          </Text>
        ) : null}
      </View>

      {item.mensaje ? (
        <Text style={{ color: "#cbd5f5", fontSize: 13, marginBottom: 4 }}>
          {item.mensaje}
        </Text>
      ) : null}

      <Text style={{ color: "#9ca3af", fontSize: 12 }}>
        Fecha: {formatDate(item.fecha_envio || item.created_at)}
      </Text>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: "#020617", padding: 16 }}>
      {/* Barra superior con volver */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          marginBottom: 12,
          justifyContent: "space-between",
        }}
      >
        <Pressable
          onPress={() => navigation.goBack()}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            paddingHorizontal: 10,
            paddingVertical: 6,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: "#4b5563",
            backgroundColor: pressed ? "#020617" : "transparent",
          })}
        >
          <Text style={{ color: "#e5e7eb", fontSize: 14 }}>Regresar a Convenios</Text>
        </Pressable>

        <Pressable
          onPress={load}
          style={({ pressed }) => ({
            backgroundColor: "#1d4ed8",
            paddingHorizontal: 12,
            paddingVertical: 6,
            borderRadius: 999,
            opacity: pressed ? 0.8 : 1,
          })}
        >
          <Text style={{ color: "#f9fafb", fontWeight: "700", fontSize: 13 }}>
            {loading ? "Actualizando…" : "Actualizar"}
          </Text>
        </Pressable>
      </View>

      <Text
        style={{
          color: "#f9fafb",
          fontSize: 20,
          fontWeight: "800",
          marginBottom: 8,
        }}
      >
        Notificaciones
      </Text>

      {err ? (
        <Text style={{ color: "#ef4444", marginBottom: 8 }}>{err}</Text>
      ) : null}

      {loading && !high.length && !medium.length ? (
        <Text style={{ color: "#9ca3af" }}>Cargando…</Text>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false}>
          {/* ALTO */}
          <Text
            style={{
              color: "#fecaca",
              fontWeight: "800",
              marginTop: 4,
              marginBottom: 4,
            }}
          >
            Prioritarias (ALTO) — {high.length}
          </Text>

          {high.length === 0 ? (
            <Text style={{ color: "#9ca3af", marginBottom: 8 }}>
              Sin notificaciones prioritarias.
            </Text>
          ) : (
            <View style={{ marginBottom: 12 }}>
              {high.map((n) => renderItem(n, "ALTO"))}
            </View>
          )}

          {/* MEDIO */}
          <Text
            style={{
              color: "#fed7aa",
              fontWeight: "800",
              marginTop: 4,
              marginBottom: 4,
            }}
          >
            Advertencias (MEDIO) — {medium.length}
          </Text>

          {medium.length === 0 ? (
            <Text style={{ color: "#9ca3af" }}>Sin advertencias.</Text>
          ) : (
            <View style={{ marginBottom: 12 }}>
              {medium.map((n) => renderItem(n, "MEDIO"))}
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

function Badge({ text, type }) {
  let bg = "#111827";
  let fg = "#e5e7eb";
  if (type === "high") {
    bg = "#b91c1c";
    fg = "#fee2e2";
  } else if (type === "medium") {
    bg = "#92400e";
    fg = "#ffedd5";
  }
  return (
    <View
      style={{
        backgroundColor: bg,
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 999,
      }}
    >
      <Text style={{ color: fg, fontWeight: "800", fontSize: 11 }}>{text}</Text>
    </View>
  );
}