import { useEffect, type CSSProperties } from "react";
import clsx from "clsx";
import { AskLauncher } from "../features/ai/AskLauncher";
import { AgentActivityView } from "../features/agents/AgentActivityView";
import { ComposerHost } from "../features/compose/ComposerHost";
import { HomeView } from "../features/home/HomeView";
import { MailView } from "../features/mail/MailView";
import { ScheduledView } from "../features/mail/ScheduledView";
import { ReceiptsView } from "../features/receipts/ReceiptsView";
import { SettingsView } from "../features/settings/SettingsView";
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

export function AppShell() {
  const { narrow } = useApp();
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
            <SettingsView section={section} onClose={() => navStore.getState().closeSettings()} />
          </div>
        ) : (
          <MainView />
        )}
      </main>
      <ComposerHost />
      <AskLauncher />
      <Overlays cmds={cmds} />
    </div>
  );
}
