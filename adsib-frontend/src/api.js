import axios from "axios";

const api = axios.create({ baseURL: "/api" });

export const getToken = () => localStorage.getItem("token") || "";
export const setToken = (t) => localStorage.setItem("token", t || "");
export const clearToken = () => localStorage.removeItem("token");

// Adjunta Authorization automáticamente
api.interceptors.request.use((config) => {
  const t = getToken();
  if (t) config.headers.Authorization = `Bearer ${t}`;
  return config;
});

// Si 401 -> redirige a /login
api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err?.response?.status === 401) {
      clearToken();
      if (window.location.pathname !== "/login") {
        window.location.href = "/login";
      }
    }
    return Promise.reject(err);
  }
);

export default api;