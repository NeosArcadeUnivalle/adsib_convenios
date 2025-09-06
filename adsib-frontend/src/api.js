import axios from "axios";
const api = axios.create({ baseURL: "/api" }); // usa el proxy del package.json
export default api;