import { describe, expect, it, vi } from "vitest";
import { FlintError, type PorchlightStatus } from "@flint/core/types";
import { createPorchlightLinkHandler, isFlintLink, parsePorchlightLink, type PorchlightLinkDeps } from "./porchlight-link";

const HOST = "porchlight.xanom.co";
const LINK = `flint://porchlight/pair?code=ABCD2345&host=${HOST}`;
const paired: PorchlightStatus = { connection: { label: "Flint on Studio", account: "n•••@xanom.co", pairedAt: 1, signedOut: false }, imported: 0, pending: 0, lastImportAt: null };

describe("parsePorchlightLink", () => {
  it("reads the code from a Porchlight pairing link", () => {
    expect(parsePorchlightLink(LINK, HOST)).toEqual({ code: "ABCD2345" });
    expect(parsePorchlightLink(`FLINT://porchlight/pair?host=${HOST}&code=abcd-2345`, HOST)).toEqual({ code: "ABCD2345" });
  });

  it("rejects links for another host or with no host", () => {
    for (const host of ["evil.example", "porchlight.xanom.co.evil.example", "porchlight.xanom.co:8443", "user@porchlight.xanom.co", ""]) {
      expect(parsePorchlightLink(`flint://porchlight/pair?code=ABCD2345&host=${encodeURIComponent(host)}`, HOST)).toBeNull();
    }
    expect(parsePorchlightLink("flint://porchlight/pair?code=ABCD2345", HOST)).toBeNull();
    expect(parsePorchlightLink(`flint://porchlight/pair?code=ABCD2345&host=${HOST}&host=evil.example`, HOST)).toBeNull();
  });

  it("rejects other schemes, paths and malformed codes", () => {
    expect(parsePorchlightLink(`https://porchlight/pair?code=ABCD2345&host=${HOST}`, HOST)).toBeNull();
    expect(parsePorchlightLink(`flint://other/pair?code=ABCD2345&host=${HOST}`, HOST)).toBeNull();
    expect(parsePorchlightLink(`flint://porchlight/unpair?code=ABCD2345&host=${HOST}`, HOST)).toBeNull();
    expect(parsePorchlightLink(`flint://porchlight/pair?code=ABC&host=${HOST}`, HOST)).toBeNull();
    expect(parsePorchlightLink(`flint://porchlight/pair?code=ABCD23456&host=${HOST}`, HOST)).toBeNull();
    expect(parsePorchlightLink(`flint://porchlight/pair?host=${HOST}`, HOST)).toBeNull();
    expect(parsePorchlightLink("not a url", HOST)).toBeNull();
  });

  it("recognizes flint links among command-line arguments", () => {
    expect(isFlintLink(LINK)).toBe(true);
    expect(isFlintLink("Flint://x")).toBe(true);
    expect(isFlintLink("mailto:a@b.co")).toBe(false);
    expect(isFlintLink("--flag")).toBe(false);
  });
});

function deps(over: Partial<PorchlightLinkDeps> = {}) {
  const base = {
    allowedHost: HOST,
    peek: vi.fn<PorchlightLinkDeps["peek"]>(async () => ({ account: "n•••@xanom.co" })),
    pair: vi.fn<PorchlightLinkDeps["pair"]>(async () => paired),
    confirm: vi.fn<PorchlightLinkDeps["confirm"]>(async () => true),
    focus: vi.fn(),
    notify: vi.fn<PorchlightLinkDeps["notify"]>(),
  };
  // Overrides are mocks too; keep the mock types so tests can read `.mock`.
  return { ...base, ...over } as typeof base;
}

describe("Porchlight pairing link", () => {
  it("checks the code, brings Flint forward, asks, then claims and says so", async () => {
    const d = deps();
    expect(await createPorchlightLinkHandler(d)(LINK)).toBe("paired");
    expect(d.peek).toHaveBeenCalledWith("ABCD2345");
    expect(d.focus).toHaveBeenCalled();
    expect(d.confirm).toHaveBeenCalledWith("n•••@xanom.co");
    expect(d.pair).toHaveBeenCalledWith("ABCD2345", { account: "n•••@xanom.co" });
    expect(d.notify).toHaveBeenCalledWith("info", "Connected to Porchlight (n•••@xanom.co).");
    // The question comes after the check and before the claim.
    expect(d.peek.mock.invocationCallOrder[0]!).toBeLessThan(d.confirm.mock.invocationCallOrder[0]!);
    expect(d.confirm.mock.invocationCallOrder[0]!).toBeLessThan(d.pair.mock.invocationCallOrder[0]!);
  });

  it("never claims when the user cancels", async () => {
    const d = deps({ confirm: vi.fn(async () => false) });
    expect(await createPorchlightLinkHandler(d)(LINK)).toBe("cancelled");
    expect(d.pair).not.toHaveBeenCalled();
    expect(d.notify).not.toHaveBeenCalled();
  });

  it("ignores a link for another host without calling Porchlight", async () => {
    const d = deps();
    expect(await createPorchlightLinkHandler(d)(`flint://porchlight/pair?code=ABCD2345&host=evil.example`)).toBe("rejected");
    expect(d.peek).not.toHaveBeenCalled();
    expect(d.confirm).not.toHaveBeenCalled();
    expect(d.pair).not.toHaveBeenCalled();
    expect(d.notify).toHaveBeenCalledWith("error", expect.stringContaining("didn't come from Porchlight"));
  });

  it("does nothing with flint links it doesn't know", async () => {
    const d = deps();
    expect(await createPorchlightLinkHandler(d)("flint://something/else")).toBe("ignored");
    expect(d.focus).not.toHaveBeenCalled();
    expect(d.notify).not.toHaveBeenCalled();
  });

  it("shows why the code check failed and doesn't ask", async () => {
    const d = deps({ peek: vi.fn(async () => { throw new FlintError("invalid", "This link expired or was already used."); }) });
    expect(await createPorchlightLinkHandler(d)(LINK)).toBe("failed");
    expect(d.confirm).not.toHaveBeenCalled();
    expect(d.pair).not.toHaveBeenCalled();
    expect(d.notify).toHaveBeenCalledWith("error", "This link expired or was already used.");
  });

  it("shows why the claim failed", async () => {
    const d = deps({ pair: vi.fn(async () => { throw new FlintError("network", "Couldn't reach Porchlight."); }) });
    expect(await createPorchlightLinkHandler(d)(LINK)).toBe("failed");
    expect(d.notify).toHaveBeenCalledWith("error", "Couldn't reach Porchlight.");
  });

  it("handles one link at a time, so a second link can't stack a second question", async () => {
    let answer: (v: boolean) => void = () => undefined;
    const d = deps({ confirm: vi.fn(() => new Promise<boolean>((r) => { answer = r; })) });
    const handle = createPorchlightLinkHandler(d);
    const first = handle(LINK);
    await vi.waitFor(() => expect(d.confirm).toHaveBeenCalledTimes(1));
    expect(await handle(LINK)).toBe("busy");
    answer(true);
    expect(await first).toBe("paired");
    expect(d.pair).toHaveBeenCalledTimes(1);
  });
});
