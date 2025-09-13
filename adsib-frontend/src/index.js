import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import PrivateRoute from "./PrivateRoute";
import Login from "./pages/Login";
import ConveniosList from "./pages/ConveniosList";
import ConvenioCreate from "./pages/ConvenioCreate";
import ConvenioDetalle from "./pages/ConvenioDetalle";
import ConvenioEdit from "./pages/ConvenioEdit";
import ConvenioComparar from "./pages/ConvenioComparar";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<PrivateRoute />}>
        <Route path="/" element={<ConveniosList />} />
        <Route path="/convenios/nuevo" element={<ConvenioCreate />} />
        <Route path="/convenios/:id" element={<ConvenioDetalle />} />
        <Route path="/convenios/:id/editar" element={<ConvenioEdit />} />
        <Route path="/convenios/:id/comparar" element={<ConvenioComparar />} />
      </Route>
    </Routes>
  </BrowserRouter>
);