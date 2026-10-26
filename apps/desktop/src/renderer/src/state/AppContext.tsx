import { createContext, useContext, useMemo } from "react";
import type { Account, DeepPartial, Settings, SidebarData } from "@flint/core";

export type AppData = {
  settings: Settings;
  updateSettings: (patch: DeepPartial<Settings>) => Promise<unknown>;
  accounts: Account[];
  /** Reload the account list after one is added or removed. */
  refreshAccounts: () => void;
  sidebar: SidebarData | undefined;
  /** Window is narrower than the rail breakpoint. */
  narrow: boolean;
  /** Addresses that mean "me": account emails and aliases. */
  selfAddresses: string[];
};

/** Everything but the sidebar, which changes on every sync tick. */
export type AppCore = Omit<AppData, "sidebar">;

/**
 * Settings, accounts and the rest of AppCore. The app's provider leaves `sidebar` out (it lives in SidebarContext);
 * tests may still pass a whole AppData here, and useApp() then reads its sidebar.
 */
export const AppContext = createContext<(AppCore & { sidebar?: SidebarData | undefined }) | null>(null);

/** Sidebar counts and sync state, kept apart so their ticks only re-render the components that read them. */
export const SidebarContext = createContext<{ sidebar: SidebarData | undefined } | null>(null);

/** Settings, accounts and friends, without subscribing to sidebar updates. */
export function useAppCore(): AppCore {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp needs the app shell");
  return ctx;
}

/** Sidebar counts and sync state, or undefined until they load. */
export function useSidebar(): SidebarData | undefined {
  const box = useContext(SidebarContext);
  const core = useContext(AppContext);
  return box ? box.sidebar : core?.sidebar;
}

/** Everything at once. Prefer useAppCore() where the sidebar isn't needed: this re-renders on every sidebar change. */
export function useApp(): AppData {
  const core = useAppCore();
  const sidebar = useSidebar();
  return useMemo(() => ({ ...core, sidebar }), [core, sidebar]);
}

export function selfAddressesOf(accounts: Account[]): string[] {
  return accounts.flatMap((a) => [a.email, ...a.aliases]).map((a) => a.toLowerCase());
}
