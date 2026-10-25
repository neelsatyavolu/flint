import { useState, type JSX } from "react";
import { AddAccount } from "./features/onboarding/AddAccount";
import { SparkOffer } from "./features/onboarding/SparkOffer";
import { AppDataProvider } from "./shell/AppDataProvider";
import { AppShell } from "./shell/AppShell";
import { useApp } from "./state/AppContext";

function Routes(): JSX.Element {
  const { accounts, refreshAccounts } = useApp();
  // Set when the first account is added; the offer stays until the user answers it.
  const [offerSpark, setOfferSpark] = useState(false);
  if (accounts.length === 0) return <AddAccount welcome onDone={() => { setOfferSpark(true); refreshAccounts(); }} />;
  return (
    <>
      <AppShell />
      {offerSpark ? <SparkOffer onDone={() => setOfferSpark(false)} /> : null}
    </>
  );
}

export function App(): JSX.Element {
  return (
    <AppDataProvider>
      <Routes />
    </AppDataProvider>
  );
}
