import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlintError } from "@flint/core/types";
import type { Account, Draft, DraftAttachment, DraftPatch, SendResult, Signature } from "@flint/core";
import { flint } from "../../lib/api";
import { useFlintQuery, useSettings } from "../../lib/hooks";
import { createAutosaver, type Autosaver, type SaveState } from "./autosave";
import { ensureDraft, setComposerMeta, type ComposerInit } from "./composerStore";
import { defaultSignatureFor, isBodyEmpty } from "./signature";
import { countRecipients } from "./recipients";

export type SessionKey = { id: string; init: ComposerInit };

export type Fields = Pick<Draft, "to" | "cc" | "bcc" | "subject" | "html" | "from" | "accountId" | "signatureId" | "track" | "remindAt" | "attachments">;

export type FromOption = { address: string; name: string; accountId: string; alias: boolean };

export type SendOutcome =
  | { ok: true; draftId: number; result: SendResult; scheduledFor?: number }
  | { ok: false; message: string };

const pick = (d: Draft): Fields => ({
  to: d.to, cc: d.cc, bcc: d.bcc, subject: d.subject, html: d.html, from: d.from, accountId: d.accountId,
  signatureId: d.signatureId, track: d.track, remindAt: d.remindAt, attachments: d.attachments,
});

export const messageOf = (err: unknown): string =>
  err instanceof FlintError || err instanceof Error ? err.message : "Something went wrong. Try again.";

/** Draft lifecycle for the full composer and the inline reply: load or create, autosave, attachments, send, discard. */
export function useComposerSession(key: SessionKey, options: { trackMeta?: boolean } = {}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [fields, setFields] = useState<Fields | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [pathless, setPathless] = useState<ReadonlySet<string>>(new Set());
  const draftIdRef = useRef<number | null>(null);
  const saverRef = useRef<Autosaver<DraftPatch> | null>(null);
  const fieldsRef = useRef<Fields | null>(null);
  fieldsRef.current = fields;

  const accounts = useFlintQuery((api) => api.listAccounts(), []);
  const signatures = useFlintQuery((api) => api.listSignatures(), []);
  const templates = useFlintQuery((api) => api.listTemplates(), []);
  const { settings } = useSettings();

  useEffect(() => {
    let alive = true;
    ensureDraft(key).then(
      (d) => {
        if (!alive) return;
        draftIdRef.current = d.id;
        saverRef.current = createAutosaver<DraftPatch>({
          save: (patch) => flint.updateDraft(d.id, patch),
          onState: (s) => alive && setSaveState(s),
        });
        setDraft(d);
        setFields(pick(d));
      },
      (err: unknown) => alive && setError(messageOf(err)),
    );
    return () => {
      alive = false;
      void saverRef.current?.flush().catch(() => undefined);
    };
    // The key is stable for the life of a composer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key.id]);

  const label = fields ? fields.subject.trim() || fields.to[0]?.name || fields.to[0]?.address || "New message" : undefined;
  useEffect(() => {
    if (options.trackMeta && draft) setComposerMeta(key.id, { draftId: draft.id, label });
  }, [options.trackMeta, key.id, draft, label]);

  const patch = useCallback((part: DraftPatch) => {
    setFields((f) => (f ? { ...f, ...part } : f));
    saverRef.current?.push(part);
  }, []);

  const fromOptions: FromOption[] = useMemo(
    () =>
      (accounts.data ?? [])
        .filter((a: Account) => a.enabled)
        .flatMap((a) => [
          { address: a.email, name: a.name, accountId: a.id, alias: false },
          ...a.aliases.map((alias) => ({ address: alias, name: a.name, accountId: a.id, alias: true })),
        ]),
    [accounts.data],
  );

  /** Switches the From address. Returns the signature the body should now carry (null = none). */
  const chooseFrom = useCallback(
    (option: FromOption): Signature | null => {
      const mode = draft?.mode === "new" ? "new" : "reply";
      const sig = defaultSignatureFor(signatures.data ?? [], option.accountId, mode, settings?.compose.defaultSignatureByAccount ?? {});
      patch({ from: option.address, accountId: option.accountId, signatureId: sig?.id ?? null });
      return sig;
    },
    [draft?.mode, patch, settings, signatures.data],
  );

  const attach = useCallback(async (files: File[]) => {
    const id = draftIdRef.current;
    if (id === null) return;
    let latest: Draft | null = null;
    const missing: string[] = [];
    for (const file of files) {
      const path = (file as File & { path?: string }).path;
      if (!path) missing.push(file.name);
      try {
        latest = await flint.addAttachment(id, path || file.name);
      } catch (err) {
        setError(messageOf(err));
      }
    }
    if (missing.length) setPathless((s) => new Set([...s, ...missing]));
    if (latest) setFields((f) => (f ? { ...f, attachments: latest!.attachments } : f));
  }, []);

  const removeAttachment = useCallback(async (attachment: DraftAttachment) => {
    const id = draftIdRef.current;
    if (id === null) return;
    setFields((f) => (f ? { ...f, attachments: f.attachments.filter((a) => a.id !== attachment.id) } : f));
    try {
      await flint.removeAttachment(id, attachment.id);
    } catch (err) {
      setError(messageOf(err));
    }
  }, []);

  const send = useCallback(async (opts?: { sendAt?: number }): Promise<SendOutcome> => {
    const id = draftIdRef.current;
    if (id === null) return { ok: false, message: "The draft isn't ready yet." };
    try {
      await saverRef.current?.flush();
      const result = await flint.sendDraft(id, opts);
      saverRef.current?.cancel();
      return { ok: true, draftId: id, result, scheduledFor: opts?.sendAt };
    } catch (err) {
      return { ok: false, message: messageOf(err) };
    }
  }, []);

  /** Saves the draft, or deletes it when there is nothing worth keeping. Resolves true when it was kept. */
  const close = useCallback(async (): Promise<boolean> => {
    const id = draftIdRef.current;
    const f = fieldsRef.current;
    if (id === null || !f) return false;
    const reply = draft?.mode === "reply" || draft?.mode === "replyAll";
    const untouched = isBodyEmpty(f.html) && f.attachments.length === 0 && (reply || (countRecipients(f) === 0 && f.subject.trim() === ""));
    try {
      if (untouched) {
        saverRef.current?.cancel();
        await flint.deleteDraft(id);
        return false;
      }
      await saverRef.current?.flush();
    } catch (err) {
      setError(messageOf(err));
    }
    return true;
  }, [draft?.mode]);

  const discard = useCallback(async () => {
    const id = draftIdRef.current;
    saverRef.current?.cancel();
    if (id !== null) await flint.deleteDraft(id).catch(() => undefined);
  }, []);

  return {
    draft, fields, error, saveState, patch, fromOptions, chooseFrom, attach, removeAttachment, pathless,
    send, close, discard, settings, signatures: signatures.data ?? [], templates: templates.data ?? [], clearError: () => setError(null),
  };
}
