import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildAuthUrl, createPkce, hasCalendarScope, parseIdToken, refreshGoogleToken, startGoogleAuth, type FetchLike } from "./google-oauth";

const idToken = (claims: object): string => `e30.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;
const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body });

type Call = { url: string; form: URLSearchParams };
function fakeGoogle(response: (form: URLSearchParams) => ReturnType<typeof json>): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    fetch: async (url, init) => {
      const form = new URLSearchParams(init?.body ?? "");
      calls.push({ url, form });
      return response(form);
    },
  };
}

describe("PKCE and URLs", () => {
  it("builds an S256 challenge from the verifier", () => {
    const { verifier, challenge } = createPkce();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(challenge).toBe(createHash("sha256").update(verifier).digest("base64url"));
  });

  it("asks for offline access with the Gmail scope", () => {
    const u = new URL(buildAuthUrl({ clientId: "cid", redirectUri: "http://127.0.0.1:1/oauth2callback", challenge: "ch", state: "st" }));
    expect(u.origin + u.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(u.searchParams.get("scope")).toBe("https://mail.google.com/ openid email profile https://www.googleapis.com/auth/calendar.events");
    expect(u.searchParams.get("include_granted_scopes")).toBeNull();
    expect(u.searchParams.get("access_type")).toBe("offline");
    expect(u.searchParams.get("prompt")).toBe("consent");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("response_type")).toBe("code");
  });

  it("adds login_hint and include_granted_scopes for incremental consent", () => {
    const u = new URL(buildAuthUrl({ clientId: "cid", redirectUri: "http://127.0.0.1:1/oauth2callback", challenge: "ch", state: "st", loginHint: "me@gmail.com" }));
    expect(u.searchParams.get("login_hint")).toBe("me@gmail.com");
    expect(u.searchParams.get("include_granted_scopes")).toBe("true");
  });

  it("detects the calendar scope in a granted-scope string", () => {
    expect(hasCalendarScope("openid https://www.googleapis.com/auth/calendar.events email")).toBe(true);
    expect(hasCalendarScope("https://mail.google.com/ openid email profile")).toBe(false);
    expect(hasCalendarScope(undefined)).toBe(false);
  });

  it("reads email and name from an ID token", () => {
    expect(parseIdToken(idToken({ email: "Me@Gmail.com", name: "Me Myself" }))).toEqual({ email: "me@gmail.com", name: "Me Myself" });
    expect(parseIdToken(idToken({ email: "a@b.c" })).name).toBe("");
    expect(() => parseIdToken("garbage")).toThrow(/account details/);
    expect(() => parseIdToken(idToken({ nope: 1 }))).toThrow(/account details/);
  });
});

describe("startGoogleAuth", () => {
  it("runs the loopback flow and returns tokens with the account identity", async () => {
    const g = fakeGoogle(() => json(200, { access_token: "AT", refresh_token: "RT", expires_in: 3600, id_token: idToken({ email: "me@gmail.com", name: "Me" }) }));
    let authUrl = "";
    const result = await startGoogleAuth({
      clientId: "cid", clientSecret: "secret", fetch: g.fetch, now: () => 1_000,
      openExternal: async (url) => {
        authUrl = url;
        const u = new URL(url);
        void fetch(`${u.searchParams.get("redirect_uri")}?code=THECODE&state=${u.searchParams.get("state")}`);
      },
    });
    expect(result).toEqual({ accessToken: "AT", refreshToken: "RT", expiresAt: 1_000 + 3_600_000, email: "me@gmail.com", name: "Me" });
    const call = g.calls[0]!;
    expect(call.url).toBe("https://oauth2.googleapis.com/token");
    expect(call.form.get("code")).toBe("THECODE");
    expect(call.form.get("grant_type")).toBe("authorization_code");
    expect(call.form.get("client_secret")).toBe("secret");
    expect(call.form.get("redirect_uri")).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/oauth2callback$/);
    const challenge = new URL(authUrl).searchParams.get("code_challenge");
    expect(createHash("sha256").update(call.form.get("code_verifier")!).digest("base64url")).toBe(challenge);
  });

  it("ignores a callback with the wrong state and keeps waiting for the real one", async () => {
    const g = fakeGoogle(() => json(200, { access_token: "AT", refresh_token: "RT", expires_in: 3600, id_token: idToken({ email: "me@gmail.com" }) }));
    let forgedBody = "";
    const result = await startGoogleAuth({
      clientId: "c", clientSecret: "s", fetch: g.fetch,
      openExternal: async (url) => {
        const u = new URL(url);
        const cb = u.searchParams.get("redirect_uri");
        void (async () => {
          const r = await fetch(`${cb}?error=%3Cscript%3E&state=forged`);
          forgedBody = await r.text();
          await fetch(`${cb}?code=x&state=${u.searchParams.get("state")}`);
        })();
      },
    });
    expect(result.email).toBe("me@gmail.com");
    expect(forgedBody).not.toContain("<script>");
    expect(g.calls).toHaveLength(1);
  });

  it("reports a cancelled consent screen", async () => {
    await expect(startGoogleAuth({
      clientId: "c", clientSecret: "s",
      openExternal: async (url) => { const u = new URL(url); void fetch(`${u.searchParams.get("redirect_uri")}?error=access_denied&state=${u.searchParams.get("state")}`); },
    })).rejects.toMatchObject({ code: "auth", message: "Google sign-in was cancelled." });
  });

  it("times out when nobody completes the flow", async () => {
    await expect(startGoogleAuth({ clientId: "c", clientSecret: "s", timeoutMs: 30, openExternal: async () => undefined })).rejects.toMatchObject({ message: expect.stringContaining("timed out") });
  });

  it("needs a client id and secret", async () => {
    await expect(startGoogleAuth({ clientId: "", clientSecret: "", openExternal: async () => undefined })).rejects.toMatchObject({ code: "invalid" });
  });

  it("explains a missing refresh token", async () => {
    const g = fakeGoogle(() => json(200, { access_token: "AT", id_token: idToken({ email: "a@b.c" }) }));
    await expect(startGoogleAuth({
      clientId: "c", clientSecret: "s", fetch: g.fetch,
      openExternal: async (url) => { const u = new URL(url); void fetch(`${u.searchParams.get("redirect_uri")}?code=x&state=${u.searchParams.get("state")}`); },
    })).rejects.toMatchObject({ message: expect.stringContaining("refresh token") });
  });

  it("surfaces a token endpoint rejection and network failure", async () => {
    const open = async (url: string) => { const u = new URL(url); void fetch(`${u.searchParams.get("redirect_uri")}?code=x&state=${u.searchParams.get("state")}`); };
    const bad = fakeGoogle(() => json(400, { error: "invalid_client" }));
    await expect(startGoogleAuth({ clientId: "c", clientSecret: "s", fetch: bad.fetch, openExternal: open })).rejects.toMatchObject({ code: "auth", message: expect.stringContaining("invalid_client") });
    await expect(startGoogleAuth({ clientId: "c", clientSecret: "s", fetch: async () => { throw new Error("offline"); }, openExternal: open })).rejects.toMatchObject({ code: "network" });
  });
});

describe("refreshGoogleToken", () => {
  it("returns a new access token and keeps the refresh token when Google does not rotate it", async () => {
    const g = fakeGoogle(() => json(200, { access_token: "NEW", expires_in: 1800 }));
    const t = await refreshGoogleToken({ clientId: "c", clientSecret: "s", refreshToken: "RT", fetch: g.fetch, now: () => 10 });
    expect(t).toEqual({ accessToken: "NEW", refreshToken: "RT", expiresAt: 10 + 1_800_000 });
    expect(g.calls[0]!.form.get("grant_type")).toBe("refresh_token");
    expect(g.calls[0]!.form.get("refresh_token")).toBe("RT");
  });

  it("adopts a rotated refresh token", async () => {
    const g = fakeGoogle(() => json(200, { access_token: "NEW", refresh_token: "RT2", expires_in: 60 }));
    expect((await refreshGoogleToken({ clientId: "c", clientSecret: "s", refreshToken: "RT", fetch: g.fetch })).refreshToken).toBe("RT2");
  });

  it("maps invalid_grant to a sign-in-again error", async () => {
    const g = fakeGoogle(() => json(400, { error: "invalid_grant" }));
    await expect(refreshGoogleToken({ clientId: "c", clientSecret: "s", refreshToken: "RT", fetch: g.fetch })).rejects.toMatchObject({ code: "auth", message: expect.stringContaining("Sign in again") });
  });
});
