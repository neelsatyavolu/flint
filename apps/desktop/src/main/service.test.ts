// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { FLINT_METHODS } from "@flint/core/api";
import { FlintError } from "@flint/core/types";
import { memorySecrets } from "@flint/core/platform";
import type { Platform } from "@flint/core/platform";
import { createMockService } from "./mock-service";
import { bootstrapService } from "./service";

const platform: Platform = {
  dataDir: "/tmp/flint-test", downloadsDir: "/tmp", secrets: memorySecrets(), appVersion: "0.0.0",
  openExternal: async () => {}, openPath: async () => {}, notify: () => {},
};
const failing = async () => { throw new Error("FlintService is not implemented yet"); };

describe("bootstrapService", () => {
  it("uses the mock when forced and never calls create", async () => {
    const create = vi.fn(failing);
    const r = await bootstrapService({ platform, forceMock: true, create });
    expect(r).toMatchObject({ ok: true, mock: true });
    expect(create).not.toHaveBeenCalled();
  });
  it("reports a fatal error instead of falling back to the mock", async () => {
    expect(await bootstrapService({ platform, forceMock: false, create: failing })).toEqual({ ok: false, message: "FlintService is not implemented yet" });
  });
  it("starts the real service when it works", async () => {
    const real = createMockService("/tmp");
    const start = vi.spyOn(real, "start");
    const r = await bootstrapService({ platform, forceMock: false, create: async () => real });
    expect(r).toMatchObject({ ok: true, mock: false });
    expect(start).toHaveBeenCalled();
  });
  it("treats a start failure like a create failure", async () => {
    const real = createMockService("/tmp");
    real.start = async () => { throw new Error("db locked"); };
    expect(await bootstrapService({ platform, forceMock: false, create: async () => real })).toEqual({ ok: false, message: "db locked" });
  });
});

describe("mock service", () => {
  it("implements every FlintApi method", () => {
    const svc = createMockService("/tmp") as unknown as Record<string, unknown>;
    for (const m of FLINT_METHODS) expect(typeof svc[m]).toBe("function");
  });
  it("returns empty valid data", async () => {
    const s = createMockService("/data");
    expect(await s.listAccounts()).toEqual([]);
    expect((await s.getSidebar()).counts.inbox).toBe(0);
    expect(await s.listThreads({ view: "inbox" })).toEqual({ items: [], bundles: [], nextCursor: null });
    expect((await s.getHome()).unreadPeople).toEqual([]);
    expect((await s.agentInfo()).socketPath).toBe("/data/agent.sock");
    expect((await s.aiStatus()).connected).toBe(false);
    await expect(s.getThread(1)).rejects.toBeInstanceOf(FlintError);
  });
  it("keeps drafts in memory and emits settings events", async () => {
    const s = createMockService("/data");
    const events: unknown[] = [];
    const off = s.subscribe((e) => events.push(e));
    const d = await s.createDraft({ mode: "new", subject: "Hi" });
    expect((await s.updateDraft(d.id, { subject: "Yo" })).subject).toBe("Yo");
    expect(await s.listDrafts()).toHaveLength(1);
    await s.sendDraft(d.id);
    await s.deleteDraft(d.id);
    expect(await s.listDrafts()).toEqual([]);
    await expect(s.getDraft(d.id)).rejects.toThrow("Draft not found");
    const next = await s.updateSettings({ appearance: { theme: "dark" } });
    expect(next.appearance.theme).toBe("dark");
    expect(events).toHaveLength(1);
    off();
    await s.updateSettings({ appearance: { theme: "light" } });
    expect(events).toHaveLength(1);
    expect(await s.saveSignature({ name: "a", html: "", accountId: null, defaultNew: false, defaultReply: false })).toMatchObject({ id: 1 });
  });
});
