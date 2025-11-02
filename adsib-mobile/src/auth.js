import React, { createContext, useEffect, useMemo, useState } from "react";
import { Alert } from "react-native";
import { clearToken, loadToken, post, saveToken, get } from "./api";

export const AuthCtx = createContext({
  user: null,
  ready: false,
  login: async () => {},
  logout: async () => {},
});

function pickToken(res) {
  return (
    res?.token ||
    res?.access_token ||
    res?.data?.token ||
    res?.data?.access_token ||
    null
  );
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const t = await loadToken();
        if (t) {
          try {
            const me = await get("/auth/me");
            setUser(me || null);
          } catch {
            await clearToken();
            setUser(null);
          }
        }
      } finally {
        setReady(true);
      }
    })();
  }, []);

  const login = async (email, password) => {
    // Tu backend: POST /auth/login -> { token, user }
    const res = await post("/auth/login", { email, password });
    const token = pickToken(res);
    if (!token) throw new Error("No se recibió token");

    await saveToken(token);

    try {
      const me = await get("/auth/me");
      setUser(me || res?.user || { email });
    } catch {
      setUser(res?.user || { email });
    }
  };

  const logout = async () => {
    try { await post("/auth/logout", {}); } catch {}
    await clearToken();
    setUser(null);
    Alert.alert("Sesión cerrada");
  };

  const value = useMemo(() => ({ user, ready, login, logout }), [user, ready]);
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}