import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import ConveniosList from "./pages/ConveniosList";
import ConvenioCreate from "./pages/ConvenioCreate";
import ConvenioDetalle from "./pages/ConvenioDetalle";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <Routes>
      <Route path="/" element={<ConveniosList />} />
      <Route path="/convenios/nuevo" element={<ConvenioCreate />} />
      <Route path="/convenios/:id" element={<ConvenioDetalle />} />
    </Routes>
  </BrowserRouter>
);