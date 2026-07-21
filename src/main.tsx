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
    const hadController = Boolean(navigator.serviceWorker.controller);
    let reloading = false;

    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!hadController || reloading) return;
      reloading = true;
      window.location.reload();
    });

    void navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" })
      .then((registration) => {
        void registration.update();

        window.setInterval(() => {
          if (navigator.onLine) void registration.update();
        }, 5 * 60_000);

        registration.addEventListener("updatefound", () => {
          const installing = registration.installing;
          if (!installing) return;

          installing.addEventListener("statechange", () => {
            if (installing.state === "installed" && navigator.serviceWorker.controller) {
              installing.postMessage({ type: "SKIP_WAITING" });
              window.dispatchEvent(new CustomEvent("neon-life:update-ready"));
            }
          });
        });
      })
      .catch(() => {
        // The application remains usable online when service-worker registration is unavailable.
      });
  });
}
