import React from "react";
import ReactDOM from "react-dom/client";
import App from "./app/App";
import "./ui/theme/tokens.css";
import "./ui/theme/global.css";
import "./ui/theme/components.css";
import "./ui/theme/responsive.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      // Offline support is optional in local preview and should never block launch.
    });
  });
}
