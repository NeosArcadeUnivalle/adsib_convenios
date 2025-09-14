import { Navigate, Outlet } from "react-router-dom";

export default function RequireAuth() {
  const token = localStorage.getItem("token"); // o donde lo guardas
  if (!token) return <Navigate to="/login" replace />;
  return <Outlet />;
}