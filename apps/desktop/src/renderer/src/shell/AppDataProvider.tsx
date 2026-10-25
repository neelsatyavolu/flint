import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useFlintQuery, useSettings } from "../lib/hooks";
import { AppContext, selfAddressesOf, type AppData } from "../state/AppContext";
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

/** Loads settings, accounts and sidebar data once and shares them. Renders a blank plane until settings and accounts arrive. */
export function AppDataProvider({ children }: { children: ReactNode }) {
  const { settings, update } = useSettings();
  const accounts = useFlintQuery((api) => api.listAccounts(), [], { refetchOn: ["settings"] });
  const sidebar = useFlintQuery((api) => api.getSidebar(), [], { refetchOn: ["sync"] });
  const narrow = useNarrow();

  const value = useMemo<AppData | null>(() => {
    if (!settings || !accounts.data) return null;
    return {
      settings,
      updateSettings: update,
      accounts: accounts.data,
      refreshAccounts: accounts.refetch,
      sidebar: sidebar.data,
      narrow,
      selfAddresses: selfAddressesOf(accounts.data),
    };
  }, [settings, update, accounts.data, accounts.refetch, sidebar.data, narrow]);

  if (!value) return <div className={styles.boot} aria-busy="true" />;
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
