import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SCENES } from "../scenes";
import type { Scene } from "../scene";
import { useSceneLayers } from "./Backdrop";

const [a, b] = SCENES as [Scene, Scene];

describe("useSceneLayers", () => {
  it("shows nothing until the photo loads", () => {
    const { result } = renderHook(() => useSceneLayers(a));
    expect(result.current.layers).toHaveLength(1);
    expect(result.current.shown).toBeNull();
    act(() => result.current.onLoad(result.current.layers[0]!.key));
    expect(result.current.shown).toBe(a);
  });

  it("keeps the old photo under the incoming one until it loads", () => {
    const { result, rerender } = renderHook(({ s }) => useSceneLayers(s), { initialProps: { s: a } });
    act(() => result.current.onLoad(result.current.layers[0]!.key));
    rerender({ s: b });
    expect(result.current.layers.map((l) => l.scene)).toEqual([a, b]);
    expect(result.current.shown).toBe(a);
    act(() => result.current.onLoad(result.current.layers[1]!.key));
    expect(result.current.shown).toBe(b);
  });

  it("mounts a fresh layer when going back to a photo still in the stack", () => {
    const { result, rerender } = renderHook(({ s }) => useSceneLayers(s), { initialProps: { s: a } });
    act(() => result.current.onLoad(result.current.layers[0]!.key));
    rerender({ s: b });
    act(() => result.current.onLoad(result.current.layers[1]!.key));
    const firstKey = result.current.layers[0]!.key;
    rerender({ s: a });
    const incoming = result.current.layers.at(-1)!;
    expect(incoming.scene).toBe(a);
    expect(incoming.key).not.toBe(firstKey);
    expect(result.current.shown).toBe(b);
  });

  it("clears for Plain", () => {
    const { result, rerender } = renderHook(({ s }: { s: Scene | null }) => useSceneLayers(s), { initialProps: { s: a as Scene | null } });
    act(() => result.current.onLoad(result.current.layers[0]!.key));
    rerender({ s: null });
    expect(result.current.layers).toEqual([]);
    expect(result.current.shown).toBeNull();
  });
});
