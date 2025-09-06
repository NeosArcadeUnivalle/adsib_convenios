import { useEffect, useState } from "react";

export default function App() {
  const [data, setData] = useState(null);
  useEffect(() => {
    fetch("/api/ping")
      .then(r => r.json())
      .then(setData)
      .catch(console.error);
  }, []);
  return <pre>{JSON.stringify(data, null, 2)}</pre>;
}