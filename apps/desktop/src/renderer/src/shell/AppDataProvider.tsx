import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useFlintQuery, useSettings } from "../lib/hooks";
import { AppContext, SidebarContext, selfAddressesOf, type AppCore } from "../state/AppContext";
import { Button, EmptyState } from "../ui";
import styles from "./AppShell.module.css";

/** Below this window width the sidebar becomes an icon rail. */
export const RAIL_BREAKPOINT = 1100;

export function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => window.innerWidth < RAIL_BREAKPOINT);
  useEffect(() => {
    const on = () => setNarrow(window.innerWidth < RAIL_BREAKPOINT);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return narrow;
}

/**
 * Loads settings, accounts and sidebar data once and shares them. Renders a blank plane until settings and accounts
 * arrive, or an error with "Try again" when either first load fails. The sidebar goes in its own context so sync
 * ticks don't re-render every reader of settings and accounts.
 */
export function AppDataProvider({ children }: { children: ReactNode }) {
  const { settings, update, error: settingsError, reload: reloadSettings } = useSettings();
  const accounts = useFlintQuery((api) => api.listAccounts(), [], { refetchOn: ["settings"], mail: false });
  const sidebar = useFlintQuery((api) => api.getSidebar(), [], { refetchOn: ["sync"] });
  const narrow = useNarrow();

  const selfAddresses = useMemo(() => (accounts.data ? selfAddressesOf(accounts.data) : []), [accounts.data]);
  const core = useMemo<AppCore | null>(() => {
    if (!settings || !accounts.data) return null;
    return { settings, updateSettings: update, accounts: accounts.data, refreshAccounts: accounts.refetch, narrow, selfAddresses };
  }, [settings, update, accounts.data, accounts.refetch, narrow, selfAddresses]);
  const sidebarValue = useMemo(() => ({ sidebar: sidebar.data }), [sidebar.data]);

  if (!core) {
    const failure = settingsError ?? (accounts.data ? undefined : accounts.error);
    if (!failure) return <div className={styles.boot} aria-busy="true" />;
    const retry = () => {
      if (!settings) reloadSettings();
      if (!accounts.data) accounts.refetch();
    };
    return (
      <div className={styles.boot}>
        <EmptyState
          title="Flint couldn't load your mail data"
          description={failure.message}
          action={<Button variant="secondary" onClick={retry}>Try again</Button>}
        />
      </div>
    );
  }
  return (
    <AppContext.Provider value={core}>
      <SidebarContext.Provider value={sidebarValue}>{children}</SidebarContext.Provider>
    </AppContext.Provider>
  );
}
