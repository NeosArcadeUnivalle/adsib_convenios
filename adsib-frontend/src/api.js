import axios from "axios";

const api = axios.create({
  baseURL: process.env.REACT_APP_API_BASE || "/api",
  // ⬇⬇⬇ subimos el tiempo máximo de espera
  timeout: 120000, // 120s
});

export const getToken = () => localStorage.getItem("token") || "";
export const setToken = (t) => localStorage.setItem("token", t || "");
export const clearToken = () => localStorage.removeItem("token");

api.interceptors.request.use((config) => {
  const t = getToken();
  if (t) config.headers.Authorization = `Bearer ${t}`;
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err?.response?.status === 401) {
      clearToken();
      if (window.location.pathname !== "/login") window.location.href = "/login";
    }
    return Promise.reject(err);
  }
);

export default api;