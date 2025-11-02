import axios from "axios";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { API_URL } from "./config";

// ---- Token helpers ----
export async function saveToken(t) {
  await AsyncStorage.setItem("token", t || "");
}
export async function loadToken() {
  return (await AsyncStorage.getItem("token")) || "";
}
export async function clearToken() {
  await AsyncStorage.removeItem("token");
}

// ---- Axios base ----
const api = axios.create({
  baseURL: API_URL,         // << usa la constante correcta
  timeout: 15000,
  headers: { Accept: "application/json" },
});

// Añade Bearer si existe token
api.interceptors.request.use(async (cfg) => {
  const t = await loadToken();
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});

// ---- Helpers ----
export async function get(url, cfg = {}) {
  const { data } = await api.get(url, cfg);
  return data;
}
export async function post(url, body, cfg = {}) {
  const { data } = await api.post(url, body, cfg);
  return data;
}

// Health-check rápido (útil cuando sale "Network Error")
export async function ping() {
  try {
    const r = await api.get("/ping", { timeout: 5000 });
    return r?.ok ?? r?.data?.ok ?? false;
  } catch {
    return false;
  }
}

export default api;