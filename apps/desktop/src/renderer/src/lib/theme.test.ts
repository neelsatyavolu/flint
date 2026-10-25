import { afterEach, describe, expect, it, vi } from "vitest";
import { applyTheme, getResolvedTheme, resolveTheme, startThemeSync } from "./theme";
import { createMockApi } from "../mock";

afterEach(() => {
  document.documentElement.removeAttribute("data-theme");
  vi.restoreAllMocks();
});

describe("theme", () => {
  it("applies explicit themes to <html>", () => {
    expect(applyTheme("light")).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(getResolvedTheme()).toBe("light");
    applyTheme("dark");
    expect(getResolvedTheme()).toBe("dark");
  });

  it("resolves 'system' from prefers-color-scheme", () => {
    vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true, addEventListener() {}, removeEventListener() {} } as unknown as MediaQueryList);
    expect(resolveTheme("system")).toBe("light");
    expect(applyTheme("system")).toBe("light");
    expect(document.documentElement.dataset.themeSetting).toBe("system");
  });

  it("follows settings events", async () => {
    const api = createMockApi({ now: Date.UTC(2026, 9, 25) });
    const stop = startThemeSync(api);
    await api.updateSettings({ appearance: { theme: "light" } });
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    await api.updateSettings({ appearance: { theme: "dark" } });
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    stop();
    await api.updateSettings({ appearance: { theme: "light" } });
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });
});
