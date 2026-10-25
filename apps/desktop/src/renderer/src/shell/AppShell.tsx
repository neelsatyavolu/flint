import { lazy, Suspense, useEffect, type CSSProperties } from "react";
import clsx from "clsx";
import { AskLauncher } from "../features/ai/AskLauncher";
import { AgentActivityView } from "../features/agents/AgentActivityView";
import { HomeView } from "../features/home/HomeView";
import { MailView } from "../features/mail/MailView";
import { ScheduledView } from "../features/mail/ScheduledView";
import { ReceiptsView } from "../features/receipts/ReceiptsView";
import { isMac } from "../lib/host";
import { ResizeHandle, usePersistedSize } from "../ui";
import { useApp } from "../state/AppContext";
import { navStore, useNav } from "../state/nav";
import { Overlays } from "./Overlays";
import { Sidebar } from "./Sidebar";
import { useAppCommands } from "./useAppCommands";
import { useGlobalShortcuts } from "./useGlobalShortcuts";
import { useHostBridge } from "./useHostBridge";
import styles from "./AppShell.module.css";

// TipTap and the settings screens are large and not needed for the first inbox paint.
const loadComposerHost = () => import("../features/compose/ComposerHost");
const loadSettings = () => import("../features/settings/SettingsView");
const ComposerHost = lazy(() => loadComposerHost().then((m) => ({ default: m.ComposerHost })));
const SettingsView = lazy(() => loadSettings().then((m) => ({ default: m.SettingsView })));

/** Warms the lazy chunks once the first paint is done, so opening them later is instant. */
function warmChunks(): void {
  const run = () => void Promise.all([loadComposerHost(), loadSettings(), import("../features/compose/InlineReplyDock")]);
  if (typeof requestIdleCallback === "function") requestIdleCallback(run, { timeout: 3000 });
  else setTimeout(run, 1500);
}

export const SIDEBAR_MIN = 200;
export const SIDEBAR_MAX = 320;
export const SIDEBAR_DEFAULT = 232;
export const RAIL_WIDTH = 56;
const TRAFFIC_LIGHTS_CLEAR = 78;
const RAIL_LIGHTS_CLEAR = 22;

function MainView() {
  const view = useNav((s) => s.view);
  switch (view) {
    case "home": return <HomeView />;
    case "receipts": return <ReceiptsView />;
    case "agent_activity": return <AgentActivityView />;
    case "scheduled": return <ScheduledView />;
    default: return <MailView />;
  }
}

/** "Ask anything" belongs on mail and Home. Settings, Read Statuses, Agent Activity and Scheduled have their own content to read. */
const NO_ASK_VIEWS = new Set(["receipts", "agent_activity", "scheduled"]);

export function AppShell() {
  const { narrow } = useApp();
  const view = useNav((s) => s.view);
  const collapsed = useNav((s) => s.sidebarCollapsed);
  const narrowExpanded = useNav((s) => s.narrowExpanded);
  const settingsOpen = useNav((s) => s.settingsOpen);
  const section = useNav((s) => s.settingsSection);
  const [width, setWidth] = usePersistedSize("flint.sidebarWidth", SIDEBAR_DEFAULT, SIDEBAR_MIN, SIDEBAR_MAX);
  const cmds = useAppCommands();
  useGlobalShortcuts(cmds);
  useHostBridge(cmds);

  const hidden = !narrow && collapsed;
  const rail = narrow;
  const lights = !isMac() ? 0 : hidden ? TRAFFIC_LIGHTS_CLEAR : rail ? RAIL_LIGHTS_CLEAR : 0;

  const sidebarPx = hidden ? 0 : rail ? RAIL_WIDTH : width;
  useEffect(() => warmChunks(), []);

  useEffect(() => {
    document.documentElement.style.setProperty("--flint-sidebar-width", `${sidebarPx}px`);
  }, [sidebarPx]);

  useEffect(() => {
    if (!narrow && narrowExpanded) navStore.getState().toggleSidebar(true);
  }, [narrow, narrowExpanded]);

  return (
    <div className={styles.shell} style={{ "--lights-inset": `${lights}px` } as CSSProperties}>
      {hidden ? null : (
        <>
          <aside className={styles.sidebar} style={{ width: rail ? RAIL_WIDTH : width }}>
            <Sidebar rail={rail} />
          </aside>
          {rail ? <div className={styles.hairline} /> : <ResizeHandle value={width} min={SIDEBAR_MIN} max={SIDEBAR_MAX} onResize={setWidth} onReset={() => setWidth(SIDEBAR_DEFAULT)} label="Resize sidebar" />}
        </>
      )}
      {narrow && narrowExpanded ? (
        <>
          <div className={styles.backdrop} onClick={() => navStore.getState().toggleSidebar(true)} />
          <aside className={styles.overlay} style={{ width: SIDEBAR_DEFAULT }}>
            <Sidebar rail={false} onNavigated={() => navStore.getState().toggleSidebar(true)} />
          </aside>
        </>
      ) : null}
      <main className={styles.main}>
        {settingsOpen ? (
          <div className={styles.settings}>
            <div className={clsx(styles.dragStrip, "drag")} />
            <Suspense fallback={null}><SettingsView section={section} onClose={() => navStore.getState().closeSettings()} /></Suspense>
          </div>
        ) : (
          <MainView />
        )}
      </main>
      <Suspense fallback={null}><ComposerHost /></Suspense>
      {/* Kept mounted (display: none) so an open conversation survives a trip through Settings. */}
      <div hidden={settingsOpen || NO_ASK_VIEWS.has(view)}><AskLauncher /></div>
      <Overlays cmds={cmds} />
    </div>
  );
}
