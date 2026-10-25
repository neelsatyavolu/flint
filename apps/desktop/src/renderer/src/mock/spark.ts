import { FlintError } from "@flint/core/types";
import type { FlintApi, FlintEvent, Signature, SparkSignatureOffer } from "@flint/core";
import type { MockState } from "./state";

const DAY = 86_400_000;

/** Two invented Spark signatures, bound to the mock accounts by address. */
function offers(state: MockState, now: number): SparkSignatureOffer[] {
  const raw = [
    {
      sparkId: "MOCK-SPARK-1", name: "Alex Rivera", modifiedAt: now - 9 * DAY,
      html: `<table cellpadding="0" cellspacing="0" style="font-size:13px;color:#3b3b36"><tr><td style="border-left:2px solid #4c8dff;padding-left:12px"><b>Alex Rivera</b><br>Design lead, Northwind<br><a href="https://northwind.example" style="color:#2f6fe0">northwind.example</a><br>+1 (415) 555-0142</td></tr></table>`,
      accounts: ["alex@northwind.dev"],
    },
    {
      sparkId: "MOCK-SPARK-2", name: "Thanks, Alex", modifiedAt: now - 120 * DAY,
      html: "<div>Thanks,</div><div>Alex</div>",
      accounts: ["alex@studio-orbit.com", "alex.rivera@gmail.com"],
    },
  ];
  return raw.map((s) => ({
    ...s,
    matches: state.accounts.filter((a) => s.accounts.includes(a.email) || a.aliases.some((x) => s.accounts.includes(x))).map((a) => ({ accountId: a.id, email: a.email })),
  }));
}

/** findSparkSignatures and importSparkSignatures over the mock state, with the same re-import rule as the real service. */
export function mockSparkApi(state: MockState, now: () => number, nextSigId: () => number, emit: (e: FlintEvent) => void): Pick<FlintApi, "findSparkSignatures" | "importSparkSignatures"> {
  const imported = new Map<string, number>();
  return {
    async findSparkSignatures(path) {
      return { path: path ?? "/Users/alex/Library/Containers/com.readdle.SparkDesktop.appstore/Data/Library/Application Support/Spark Desktop/core-data/settings.sqlite", signatures: offers(state, now()) };
    },
    async importSparkSignatures(input) {
      const found = new Map(offers(state, now()).map((o) => [o.sparkId, o]));
      const saved: Signature[] = [];
      for (const item of input.items) {
        const offer = found.get(item.sparkId);
        if (!offer) throw new FlintError("not_found", "Spark no longer has one of those signatures. Reopen the import and try again.");
        const prior = state.signatures.find((s) => s.id === imported.get(item.sparkId));
        const sig: Signature = { id: prior?.id ?? nextSigId(), name: item.name?.trim() || offer.name, html: offer.html, accountId: null, defaultNew: prior?.defaultNew ?? false, defaultReply: prior?.defaultReply ?? false };
        state.signatures = prior ? state.signatures.map((s) => (s.id === sig.id ? sig : s)) : [...state.signatures, sig];
        imported.set(item.sparkId, sig.id);
        for (const accountId of item.setDefaultFor) {
          state.settings = { ...state.settings, compose: { ...state.settings.compose, defaultSignatureByAccount: { ...state.settings.compose.defaultSignatureByAccount, [accountId]: sig.id } } };
        }
        saved.push(sig);
      }
      if (input.items.some((i) => i.setDefaultFor.length > 0)) emit({ type: "settings", settings: state.settings });
      return saved;
    },
  };
}
