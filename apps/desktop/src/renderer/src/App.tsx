import type { JSX } from "react";
import { AddAccount } from "./features/onboarding/AddAccount";
import { AppDataProvider } from "./shell/AppDataProvider";
import { AppShell } from "./shell/AppShell";
import { useApp } from "./state/AppContext";

function Routes(): JSX.Element {
  const { accounts, refreshAccounts } = useApp();
  if (accounts.length === 0) return <AddAccount welcome onDone={refreshAccounts} />;
  return <AppShell />;
}

export function App(): JSX.Element {
  return (
    <AppDataProvider>
      <Routes />
    </AppDataProvider>
  );
}
