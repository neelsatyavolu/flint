import { useCallback, useEffect, useRef, useState, type DependencyList } from "react";
import type { DeepPartial, FlintApi, FlintEvent, Settings } from "@flint/core";
import { flint } from "./api";

type EventType = FlintEvent["type"];
type EventOf<T extends EventType> = Extract<FlintEvent, { type: T }>;

/** Runs `handler` for every event of `type`. The handler may change between renders. */
export function useFlintEvent<T extends EventType>(type: T, handler: (event: EventOf<T>) => void): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(
    () =>
      flint.subscribe((e) => {
        if (e.type === type) ref.current(e as EventOf<T>);
      }),
    [type],
  );
}

export type QueryState<T> = { data: T | undefined; error: Error | undefined; loading: boolean; refetch: () => void };

/**
 * Loads data from the API and reloads it on 'mail_changed' (and any extra `refetchOn` event types).
 * Previous data stays in place while reloading, so lists never flash empty. Stale responses are dropped.
 */
export function useFlintQuery<T>(
  fetcher: (api: FlintApi) => Promise<T>,
  deps: DependencyList,
  options: { refetchOn?: EventType[]; enabled?: boolean } = {},
): QueryState<T> {
  const { refetchOn = [], enabled = true } = options;
  const [state, setState] = useState<{ data: T | undefined; error: Error | undefined; loading: boolean }>({
    data: undefined,
    error: undefined,
    loading: enabled,
  });
  const fetchRef = useRef(fetcher);
  fetchRef.current = fetcher;
  const seq = useRef(0);

  const run = useCallback(() => {
    const id = ++seq.current;
    setState((s) => ({ ...s, loading: true }));
    fetchRef.current(flint).then(
      (data) => {
        if (id === seq.current) setState({ data, error: undefined, loading: false });
      },
      (err: unknown) => {
        if (id === seq.current) setState((s) => ({ ...s, error: err instanceof Error ? err : new Error(String(err)), loading: false }));
      },
    );
  }, []);

  const key = refetchOn.join(",");
  useEffect(() => {
    if (!enabled) return;
    run();
    const types = new Set<EventType>(["mail_changed", ...refetchOn]);
    const off = flint.subscribe((e) => {
      if (types.has(e.type)) run();
    });
    return () => {
      seq.current++;
      off();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, enabled, key, ...deps]);

  return { ...state, refetch: run };
}

/** Current settings, kept live through 'settings' events. update() merges a deep patch. */
export function useSettings(): { settings: Settings | undefined; update: (patch: DeepPartial<Settings>) => Promise<Settings> } {
  const [settings, setSettings] = useState<Settings | undefined>();
  useEffect(() => {
    let alive = true;
    flint.getSettings().then((s) => alive && setSettings(s), () => undefined);
    return () => {
      alive = false;
    };
  }, []);
  useFlintEvent("settings", (e) => setSettings(e.settings));
  const update = useCallback(async (patch: DeepPartial<Settings>) => {
    const next = await flint.updateSettings(patch);
    setSettings(next);
    return next;
  }, []);
  return { settings, update };
}
