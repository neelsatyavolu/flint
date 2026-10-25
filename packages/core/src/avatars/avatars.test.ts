import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { avatarsApi, fetchGoogleAccountPhoto, isGooglePictureUrl } from "../service/avatars";
import type { ServiceContext } from "../service/context";
import { DEFAULT_SETTINGS } from "../store/settings";
import { makeStore, seedImap } from "../store/testkit";
import { parseIdToken } from "../mail/google-oauth";
import { parseImageDataUrl, sniffImage } from "./images";
import { createLimiter } from "./limiter";
import { ERROR_TTL_MS, NEGATIVE_TTL_MS, POSITIVE_TTL_MS } from "./store";

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const JPG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const pngUrl = `data:image/png;base64,${Buffer.from(PNG).toString("base64")}`;
const res = (status: number, body: Uint8Array = new Uint8Array()) => new Response(status === 404 ? null : body, { status });

function setup(over: { fetch?: typeof fetch; senderPhotos?: boolean } = {}) {
  const store = makeStore();
  const { account } = seedImap(store);
  const clock = { t: 1_000_000 };
  const dataDir = mkdtempSync(join(tmpdir(), "flint-avatars-"));
  const fetchFn = vi.fn(over.fetch ?? (async () => res(404)));
  const emit = vi.fn();
  const settings = { ...DEFAULT_SETTINGS, appearance: { ...DEFAULT_SETTINGS.appearance, senderPhotos: over.senderPhotos ?? true } };
  const ctx = { store, platform: { dataDir }, now: () => clock.t, fetch: fetchFn as unknown as typeof fetch, emit, getSettings: () => settings } as unknown as ServiceContext;
  return { ctx, api: avatarsApi(ctx), account, clock, fetchFn, emit, dataDir, store };
}

describe("image helpers", () => {
  it("recognizes images by bytes", () => {
    expect(sniffImage(PNG)).toBe("image/png");
    expect(sniffImage(JPG)).toBe("image/jpeg");
    expect(sniffImage(Uint8Array.from([60, 115, 118, 103]))).toBeNull();
  });
  it("accepts only png or jpeg data URLs whose bytes match", () => {
    expect(parseImageDataUrl(pngUrl)).not.toBeNull();
    expect(parseImageDataUrl(`data:image/jpeg;base64,${Buffer.from(JPG).toString("base64")}`)).not.toBeNull();
    expect(parseImageDataUrl(`data:image/png;base64,${Buffer.from("<svg/>").toString("base64")}`)).toBeNull();
    expect(parseImageDataUrl(`data:image/svg+xml;base64,${Buffer.from(PNG).toString("base64")}`)).toBeNull();
    expect(parseImageDataUrl("https://example.com/a.png")).toBeNull();
    const big = Buffer.concat([Buffer.from(PNG), Buffer.alloc(1024 * 1024)]);
    expect(parseImageDataUrl(`data:image/png;base64,${big.toString("base64")}`)).toBeNull();
  });
});

describe("limiter", () => {
  it("never runs more than max at once", async () => {
    const run = createLimiter(3);
    let active = 0;
    let peak = 0;
    await Promise.all(Array.from({ length: 10 }, () => run(async () => {
      active++; peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 2));
      active--;
    })));
    expect(peak).toBe(3);
  });
});

describe("setAccountAvatar", () => {
  it("stores a custom photo, serves it and falls back to nothing on remove", async () => {
    const { api, account, emit, store } = setup();
    const updated = await api.setAccountAvatar(account.id, pngUrl);
    expect(updated.avatarSource).toBe("custom");
    expect(updated.avatarUpdatedAt).toBe(1_000_000);
    expect(emit).toHaveBeenCalled();
    expect((await api.getAvatars([{ kind: "account", accountId: account.id }]))[`account:${account.id}`]).toBe(pngUrl);
    const removed = await api.setAccountAvatar(account.id, null);
    expect(removed.avatarSource).toBeNull();
    expect(store.requireAccount(account.id).avatarUpdatedAt).toBeNull();
    expect((await api.getAvatars([{ kind: "account", accountId: account.id }]))[`account:${account.id}`]).toBeNull();
  });
  it("rejects anything that is not a small png or jpeg", async () => {
    const { api, account } = setup();
    await expect(api.setAccountAvatar(account.id, "data:image/png;base64,AAAA")).rejects.toMatchObject({ code: "invalid" });
    await expect(api.setAccountAvatar("nope", pngUrl)).rejects.toBeTruthy();
  });
  it("removing a custom photo falls back to the Google picture", async () => {
    const { api, ctx, account, store } = setup({ fetch: async () => res(200, JPG) });
    await fetchGoogleAccountPhoto(ctx, account, "https://lh3.googleusercontent.com/a/x=s96-c");
    await api.setAccountAvatar(account.id, pngUrl);
    expect(store.requireAccount(account.id).avatarSource).toBe("custom");
    const back = await api.setAccountAvatar(account.id, null);
    expect(back.avatarSource).toBe("google");
    expect((await api.getAvatars([{ kind: "account", accountId: account.id }]))[`account:${account.id}`]).toMatch(/^data:image\/jpeg/);
  });
});

describe("Google picture", () => {
  it("only trusts googleusercontent.com over https", () => {
    expect(isGooglePictureUrl("https://lh3.googleusercontent.com/a/x")).toBe(true);
    expect(isGooglePictureUrl("http://lh3.googleusercontent.com/a/x")).toBe(false);
    expect(isGooglePictureUrl("https://evil.example/googleusercontent.com")).toBe(false);
    expect(isGooglePictureUrl("https://169.254.169.254/x")).toBe(false);
  });
  it("downloads the larger size anonymously and sets the source", async () => {
    const { ctx, account, fetchFn } = setup({ fetch: async () => res(200, PNG) });
    const next = await fetchGoogleAccountPhoto(ctx, account, "https://lh3.googleusercontent.com/a/x=s96-c");
    expect(next.avatarSource).toBe("google");
    const [url, init] = fetchFn.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe("https://lh3.googleusercontent.com/a/x=s256-c");
    expect(init.credentials).toBe("omit");
    expect(init.referrerPolicy).toBe("no-referrer");
    expect(init.signal).toBeTruthy();
  });
  it("leaves the account alone when there is no picture or the download fails", async () => {
    const { ctx, account, fetchFn } = setup({ fetch: async () => { throw new Error("offline"); } });
    expect((await fetchGoogleAccountPhoto(ctx, account, undefined)).avatarSource).toBeNull();
    expect((await fetchGoogleAccountPhoto(ctx, account, "https://lh3.googleusercontent.com/a/x")).avatarSource).toBeNull();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

describe("sender photos", () => {
  const ref = (address: string) => ({ kind: "sender" as const, address });

  it("asks Gravatar with the SHA-256 of the lowercased address and caches the hit for 7 days", async () => {
    const { api, fetchFn, clock } = setup({ fetch: async () => res(200, JPG) });
    const out = await api.getAvatars([ref(" Carla@Example.ORG ")]);
    expect(out["sender:carla@example.org"]).toMatch(/^data:image\/jpeg;base64,/);
    const url = fetchFn.mock.calls[0]![0] as string;
    expect(url).toMatch(/^https:\/\/www\.gravatar\.com\/avatar\/[0-9a-f]{64}\?s=128&d=404$/);
    expect(url).not.toContain("carla");
    await api.getAvatars([ref("carla@example.org")]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    clock.t += POSITIVE_TTL_MS + 1;
    await api.getAvatars([ref("carla@example.org")]);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("remembers a miss for a day and a network error for a shorter time", async () => {
    const { api, fetchFn, clock } = setup();
    expect((await api.getAvatars([ref("nobody@example.org")]))["sender:nobody@example.org"]).toBeNull();
    await api.getAvatars([ref("nobody@example.org")]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    clock.t += NEGATIVE_TTL_MS + 1;
    await api.getAvatars([ref("nobody@example.org")]);
    expect(fetchFn).toHaveBeenCalledTimes(2);

    const failing = setup({ fetch: async () => { throw new Error("offline"); } });
    await failing.api.getAvatars([ref("x@example.org")]);
    await failing.api.getAvatars([ref("x@example.org")]);
    expect(failing.fetchFn).toHaveBeenCalledTimes(1);
    failing.clock.t += ERROR_TTL_MS + 1;
    await failing.api.getAvatars([ref("x@example.org")]);
    expect(failing.fetchFn).toHaveBeenCalledTimes(2);
  });

  it("does not contact Gravatar when senderPhotos is off", async () => {
    const { api, fetchFn } = setup({ senderPhotos: false });
    expect((await api.getAvatars([ref("a@example.org")]))["sender:a@example.org"]).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("ships with sender photos off", () => {
    expect(DEFAULT_SETTINGS.appearance.senderPhotos).toBe(false);
  });

  it("stops reading an oversized body and never caches it as a photo", async () => {
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        pulled += 256 * 1024;
        c.enqueue(new Uint8Array(256 * 1024).fill(1));
        if (pulled > 50 * 1024 * 1024) c.close();
      },
    });
    const { api } = setup({ fetch: async () => new Response(body, { status: 200 }) });
    expect((await api.getAvatars([ref("a@example.org")]))["sender:a@example.org"]).toBeNull();
    expect(pulled).toBeLessThan(5 * 1024 * 1024);
  });

  it("rejects non-image responses and skips invalid addresses", async () => {
    const { api, fetchFn } = setup({ fetch: async () => res(200, Buffer.from("<html>")) });
    expect((await api.getAvatars([ref("a@example.org"), ref("not-an-address")]))["sender:a@example.org"]).toBeNull();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("maps the user's own addresses and aliases to the account photo without any request", async () => {
    const { api, account, fetchFn, store } = setup();
    store.updateAccount(account.id, { aliases: ["alias@example.com"] });
    await api.setAccountAvatar(account.id, pngUrl);
    const out = await api.getAvatars([ref("ME@example.com"), ref("alias@example.com")]);
    expect(out["sender:me@example.com"]).toBe(pngUrl);
    expect(out["sender:alias@example.com"]).toBe(pngUrl);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("keeps files under <dataDir>/avatars only", async () => {
    const { api, account, dataDir } = setup({ fetch: async () => res(200, PNG) });
    await api.setAccountAvatar(account.id, pngUrl);
    await api.getAvatars([ref("a@example.org")]);
    expect(readdirSync(dataDir)).toEqual(["avatars"]);
  });
});

describe("ID token picture", () => {
  const token = (claims: object) => `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;
  it("passes the picture claim through when present", () => {
    expect(parseIdToken(token({ email: "A@b.c", picture: "https://lh3.googleusercontent.com/x" })).picture).toBe("https://lh3.googleusercontent.com/x");
    expect(parseIdToken(token({ email: "a@b.c" })).picture).toBeUndefined();
  });
});
