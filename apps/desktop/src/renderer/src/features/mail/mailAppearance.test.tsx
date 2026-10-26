import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, render, renderHook } from "@testing-library/react";
import type { MessageView, Settings } from "@flint/core";
import { AppContext, type AppData } from "../../state/AppContext";
import { defaultSettings } from "../../mock/fixtures";
import { MailFrame } from "../../ui/MailFrame";
import { useMailAppearance, useOriginalChoice } from "./mailAppearance";
import { BACKGROUND_IMAGE_NEWSLETTER } from "../../lib/mailDark/fixtures/backgroundImageNewsletter";
import { GMAIL_REPLY } from "../../lib/mailDark/fixtures/gmailReply";

const base = { id: 1, html: GMAIL_REPLY, text: null } as unknown as MessageView;
const message = (over: Partial<MessageView> = {}): MessageView => ({ ...base, ...over });

function wrapperFor(emailAppearance: Settings["appearance"]["emailAppearance"]) {
  const settings = defaultSettings();
  settings.appearance.emailAppearance = emailAppearance;
  const app = { settings } as unknown as AppData;
  return ({ children }: { children: React.ReactNode }) => <AppContext.Provider value={app}>{children}</AppContext.Provider>;
}

const setTheme = (t: "dark" | "light") => document.documentElement.setAttribute("data-theme", t);

beforeEach(() => {
  setTheme("dark");
  useOriginalChoice.setState({ original: {} });
});
afterEach(() => document.documentElement.removeAttribute("data-theme"));

describe("useMailAppearance", () => {
  it("adapts HTML in dark with match, on the theme sheet", () => {
    const { result } = renderHook(() => useMailAppearance(message()), { wrapper: wrapperFor("match") });
    expect(result.current.sheet).toBe("theme");
    expect(result.current.canToggle).toBe(true);
    expect(result.current.showingOriginal).toBe(false);
    expect(result.current.html).not.toBe(GMAIL_REPLY);
    expect(result.current.html).toContain("#4c8dff");
  });

  it("toggleOriginal shows the original on a light sheet and back", () => {
    const { result } = renderHook(() => useMailAppearance(message()), { wrapper: wrapperFor("match") });
    act(() => result.current.toggleOriginal());
    expect(result.current).toMatchObject({ html: GMAIL_REPLY, sheet: "light-sheet", showingOriginal: true, canToggle: true });
    act(() => result.current.toggleOriginal());
    expect(result.current.showingOriginal).toBe(false);
  });

  it("falls back to the light sheet for mail that cannot be adapted, and 'Use dark' opts in", () => {
    const { result } = renderHook(() => useMailAppearance(message({ html: BACKGROUND_IMAGE_NEWSLETTER })), { wrapper: wrapperFor("match") });
    expect(result.current).toMatchObject({ html: BACKGROUND_IMAGE_NEWSLETTER, sheet: "light-sheet", showingOriginal: true, canToggle: true });
    act(() => result.current.toggleOriginal());
    expect(result.current).toMatchObject({ sheet: "theme", showingOriginal: false });
    expect(result.current.html).not.toBe(BACKGROUND_IMAGE_NEWSLETTER);
  });

  it("'light' always shows the original and offers no toggle", () => {
    const { result } = renderHook(() => useMailAppearance(message()), { wrapper: wrapperFor("light") });
    expect(result.current).toMatchObject({ html: GMAIL_REPLY, sheet: "light-sheet", canToggle: false, showingOriginal: true });
  });

  it("does not touch mail in the light theme", () => {
    setTheme("light");
    const { result } = renderHook(() => useMailAppearance(message()), { wrapper: wrapperFor("match") });
    expect(result.current).toMatchObject({ html: GMAIL_REPLY, sheet: "light-sheet", canToggle: false });
  });

  it("returns null html for plain text", () => {
    const { result } = renderHook(() => useMailAppearance(message({ html: null, text: "hello" })), { wrapper: wrapperFor("match") });
    expect(result.current).toMatchObject({ html: null, sheet: "theme", canToggle: false, showingOriginal: false });
  });

  it("follows a theme change without a reload", async () => {
    const { result } = renderHook(() => useMailAppearance(message()), { wrapper: wrapperFor("match") });
    expect(result.current.canToggle).toBe(true);
    await act(async () => {
      setTheme("light");
      await Promise.resolve();
    });
    expect(result.current.canToggle).toBe(false);
    expect(result.current.html).toBe(GMAIL_REPLY);
  });

  it("adapts nothing until enabled, e.g. before the message menu opens", () => {
    const { result, rerender } = renderHook(({ on }) => useMailAppearance(message(), on), { wrapper: wrapperFor("match"), initialProps: { on: false } });
    expect(result.current.canToggle).toBe(false);
    rerender({ on: true });
    expect(result.current.canToggle).toBe(true);
  });

  it("keeps the choice per message", () => {
    const a = renderHook(() => useMailAppearance(message({ id: 1 })), { wrapper: wrapperFor("match") });
    const b = renderHook(() => useMailAppearance(message({ id: 2 })), { wrapper: wrapperFor("match") });
    act(() => a.result.current.toggleOriginal());
    expect(a.result.current.showingOriginal).toBe(true);
    expect(b.result.current.showingOriginal).toBe(false);
  });
});

describe("MailFrame sheet", () => {
  const frame = (props: Partial<React.ComponentProps<typeof MailFrame>>) => render(<MailFrame html="<p>Hi</p>" allowRemoteImages={false} {...props} />).container.querySelector("iframe")!;

  it("theme sheet paints the dark card tone and a dark color scheme", () => {
    const f = frame({ sheet: "theme" });
    expect(f.getAttribute("srcdoc")).toContain("color-scheme:dark");
    expect(f.getAttribute("data-sheet")).toBe("theme");
    expect(f.getAttribute("srcdoc")).toContain("border-left:2px solid");
  });
  it("light sheet is white and rounded", () => {
    const f = frame({ sheet: "light-sheet" });
    expect(f.getAttribute("srcdoc")).toContain("color-scheme:light");
    expect(f.getAttribute("srcdoc")).toContain("#ffffff");
    expect(f.style.borderRadius).not.toBe("");
  });
  it("keeps the old white sheet when no sheet is given", () => {
    const f = frame({});
    expect(f.getAttribute("srcdoc")).toContain("#ffffff");
    expect(f.getAttribute("data-sheet")).toBeNull();
    expect(f.style.borderRadius).toBe("");
  });
});
