import { createContext, useContext } from "react";
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

export const AppContext = createContext<AppData | null>(null);

export function useApp(): AppData {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp needs the app shell");
  return ctx;
}

export function selfAddressesOf(accounts: Account[]): string[] {
  return accounts.flatMap((a) => [a.email, ...a.aliases]).map((a) => a.toLowerCase());
}
