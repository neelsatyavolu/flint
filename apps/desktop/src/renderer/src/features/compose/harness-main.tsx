import { createRoot } from "react-dom/client";
import "../../styles/base.css";
import { flint } from "../../lib/api";
import { startThemeSync } from "../../lib/theme";
import { shortcuts } from "../../lib/shortcuts";
import { ToastProvider } from "../../ui/Toast";
import { Harness } from "./Harness";

startThemeSync(flint);
shortcuts.attach(document);
createRoot(document.getElementById("root")!).render(<ToastProvider><Harness /></ToastProvider>);
