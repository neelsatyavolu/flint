import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/base.css";
import { flint } from "./lib/api";
import { startThemeSync } from "./lib/theme";
import { shortcuts } from "./lib/shortcuts";
import { ToastProvider } from "./ui/Toast";
import { App } from "./App";

startThemeSync(flint);
shortcuts.attach(document);

const params = new URLSearchParams(window.location.search);
const showGallery = params.has("gallery");

async function boot() {
  const root = createRoot(document.getElementById("root")!);
  let view = <App />;
  if (showGallery) {
    const { Gallery } = await import("./ui/gallery/Gallery");
    view = <Gallery />;
  }
  root.render(
    <StrictMode>
      <ToastProvider>{view}</ToastProvider>
    </StrictMode>,
  );
}

void boot();
