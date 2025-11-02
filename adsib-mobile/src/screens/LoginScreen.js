import React, { useContext, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Image,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import { AuthCtx } from "../auth";

export default function LoginScreen() {
  const { login } = useContext(AuthCtx);
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const onSubmit = async () => {
    setErr("");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setErr("Correo inválido"); return;
    }
    if (pass.length < 8) { setErr("La contraseña debe tener 8+ caracteres"); return; }
    try {
      setLoading(true);
      // ¡SIN navigation.reset! el AuthProvider conmuta automáticamente
      await login(email.trim(), pass);
    } catch (e) {
      setErr(e?.response?.data?.message || "Credenciales inválidas");
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: "#0b0c0f" }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: 20 }}
        keyboardShouldPersistTaps="handled"
      >
        <View
          style={{
            backgroundColor: "#12151b",
            borderColor: "#1f2937",
            borderWidth: 1,
            borderRadius: 16,
            padding: 18,
            shadowColor: "#000",
            shadowOpacity: 0.35,
            shadowRadius: 20,
          }}
        >
          <Text style={{ color: "#e5e7eb", fontSize: 26, fontWeight: "900", textAlign: "center", marginBottom: 12 }}>
            Iniciar sesión
          </Text>

          <View style={{ alignItems: "center", marginBottom: 16 }}>
            <Image
              source={require("../../assets/adsib.jpg")}
              style={{ width: 120, height: 120, borderRadius: 80, borderWidth: 2, borderColor: "#1a6779" }}
            />
          </View>

          {!!err && (
            <View style={{ backgroundColor: "#7f1d1d", padding: 10, borderRadius: 10, marginBottom: 10 }}>
              <Text style={{ color: "#fee2e2", textAlign: "center" }}>{err}</Text>
            </View>
          )}

          <Text style={{ color: "#9ca3af", marginBottom: 6 }}>Correo</Text>
          <TextInput
            placeholder="usuario@dominio.com"
            placeholderTextColor="#6b7280"
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
            style={styles.input}
            returnKeyType="next"
          />

          <Text style={{ color: "#9ca3af", marginTop: 10, marginBottom: 6 }}>Contraseña</Text>
          <TextInput
            placeholder="••••••••"
            placeholderTextColor="#6b7280"
            secureTextEntry
            value={pass}
            onChangeText={setPass}
            style={styles.input}
            returnKeyType="done"
            onSubmitEditing={onSubmit}
          />

          <Pressable
            onPress={onSubmit}
            disabled={loading}
            style={({ pressed }) => [
              styles.btn,
              { opacity: loading ? 0.6 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] },
            ]}
          >
            <Text style={{ color: "#0b1220", fontWeight: "900", textAlign: "center" }}>
              {loading ? "Ingresando…" : "Ingresar"}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = {
  input: {
    backgroundColor: "#0b0c0f",
    borderWidth: 1,
    borderColor: "#1f2937",
    color: "#e5e7eb",
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 10,
  },
  btn: {
    marginTop: 16,
    backgroundColor: "#10b981",
    paddingVertical: 14,
    borderRadius: 12,
    shadowColor: "#10b981",
    shadowOpacity: 0.35,
    shadowRadius: 12,
  },
};