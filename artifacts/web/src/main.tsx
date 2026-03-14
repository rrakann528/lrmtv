import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

if ("serviceWorker" in navigator) {
  const base = import.meta.env.BASE_URL || "/";
  const swUrl = `${base}sw.js`.replace(/\/\//g, "/");
  navigator.serviceWorker.register(swUrl, { scope: base }).catch((err) => {
    console.error("Service Worker registration failed:", err);
  });
}

createRoot(document.getElementById("root")!).render(<App />);
