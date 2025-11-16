// src/index.js
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

import RequireAuth from "./auth/RequireAuth";
import AppShell from "./components/ui/AppShell";

import ConveniosList from "./pages/ConveniosList";
import ConvenioCreate from "./pages/ConvenioCreate";
import ConvenioDetalle from "./pages/ConvenioDetalle";
import ConvenioEdit from "./pages/ConvenioEdit";
import ConvenioComparar from "./pages/ConvenioComparar";
import NotificacionesPage from "./pages/NotificacionesPage";
import Login from "./pages/Login";
import ConvenioRiesgo from "./pages/ConvenioRiesgo";
import AssistantPage from "./pages/AssistantPage";

// Páginas de Usuarios
import UsersList from "./pages/UsersList";
import UserCreate from "./pages/UserCreate";
import UserEdit from "./pages/UserEdit";
import RecoverPassword from "./pages/RecoverPassword";

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <BrowserRouter>
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/recuperar-contraseña" element={<RecoverPassword />} />
      {/* Rutas protegidas por sesión */}
      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          {/* Convenios */}
          <Route path="/" element={<ConveniosList />} />
          <Route path="/convenios/nuevo" element={<ConvenioCreate />} />
          <Route path="/convenios/:id" element={<ConvenioDetalle />} />
          <Route path="/convenios/:id/editar" element={<ConvenioEdit />} />
          <Route path="/convenios/:id/comparar" element={<ConvenioComparar />} />
          <Route path="/convenios/:id/riesgo" element={<ConvenioRiesgo />} />
          <Route path="/asistente" element={<AssistantPage />} />
          
          {/* Notificaciones */}
          <Route path="/notificaciones" element={<NotificacionesPage />} />

          {/* Usuarios (CRUD) */}
          <Route path="/usuarios" element={<UsersList />} />
          <Route path="/usuarios/nuevo" element={<UserCreate />} />
          <Route path="/usuarios/:id/editar" element={<UserEdit />} />
        </Route>
      </Route>

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  </BrowserRouter>
);