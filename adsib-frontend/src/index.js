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
import ConvenioDocxViewer from "./pages/ConvenioDocxViewer";
import AssistantPage from "./pages/AssistantPage";

import UsersList from "./pages/UsersList";
import UserCreate from "./pages/UserCreate";
import UserEdit from "./pages/UserEdit";
import RecoverPassword from "./pages/RecoverPassword";
import RiesgoKeywords from "./pages/RiesgoKeywords";

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <BrowserRouter>
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/recuperar-contraseña" element={<RecoverPassword />} />

      <Route element={<RequireAuth />}>
        <Route path="/convenios/:id/documento-base" element={<ConvenioDocxViewer />} />

        <Route element={<AppShell />}>
          <Route path="/" element={<ConveniosList />} />
          <Route path="/convenios/nuevo" element={<ConvenioCreate />} />
          <Route path="/convenios/:id" element={<ConvenioDetalle />} />
          <Route path="/convenios/:id/editar" element={<ConvenioEdit />} />
          <Route path="/convenios/:id/comparar" element={<ConvenioComparar />} />
          <Route path="/convenios/:id/riesgo" element={<ConvenioRiesgo />} />
          <Route path="/asistente" element={<AssistantPage />} />
          <Route path="/riesgos/keywords" element={<RiesgoKeywords />} />
          <Route path="/notificaciones" element={<NotificacionesPage />} />
          <Route path="/usuarios" element={<UsersList />} />
          <Route path="/usuarios/nuevo" element={<UserCreate />} />
          <Route path="/usuarios/:id/editar" element={<UserEdit />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  </BrowserRouter>
);
