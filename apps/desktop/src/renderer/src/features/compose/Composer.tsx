import { useContext, useEffect, useRef, useState, type DragEvent, type JSX, type KeyboardEvent } from "react";
import { EyeOff } from "lucide-react";
import type { Signature, Template } from "@flint/core";
import { AppContext } from "../../state/AppContext";
import { formatRecipients } from "../../lib/format";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { AiBar } from "../ai/AiBar";
import { AttachmentChips } from "./AttachmentChips";
import { ComposerBar } from "./ComposerBar";
import { closeComposer, minimizeComposer, type ComposerEntry } from "./composerStore";
import { BodyEditor, type BodyEditorHandle } from "./editor/BodyEditor";
import { sanitizeSignatureHtml } from "./editor/sanitize";
import { receiptBlocker } from "./receiptNote";
import { QuotedPill } from "./QuotedPill";
import { RecipientField } from "./RecipientField";
import { useComposerSession } from "./useComposerSession";
import { useSendFlow } from "./useSendFlow";
import styles from "./Composer.module.css";

type Props = { entry: ComposerEntry; hidden: boolean };

/** The full composer. Stays mounted while minimized so the editor keeps its state. */
export function Composer({ entry, hidden }: Props): JSX.Element {
  const session = useComposerSession({ id: entry.id, init: entry.init }, { trackMeta: true });
  const { fields, draft, patch } = session;
  const body = useRef<BodyEditorHandle>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [showCc, setShowCc] = useState(false);
  const [showBcc, setShowBcc] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const flow = useSendFlow(session, () => closeComposer(entry.id));
  const selfAddresses = useContext(AppContext)?.selfAddresses ?? [];
  const closeRef = useRef<() => void>(() => undefined);

  // Escape closes the composer (draft saved) even when focus is on the page rather than inside it.
  useEffect(() => {
    if (hidden) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const t = e.target as Element | null;
      if (t && t !== document.body && t.closest("[role=dialog],[role=menu],[role=listbox],[role=tooltip],input,textarea,[contenteditable=true]")) return;
      if (document.querySelector("[role=menu],[role=dialog][aria-modal=true]")) return;
      e.preventDefault();
      closeRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [hidden]);

  if (!fields || !draft) {
    return <div className={`t-body ${styles.loading}`}>{session.error ?? "Opening draft"}</div>;
  }

  // The live check wins. Core's reason on the draft is a snapshot from when it opened, so it only stands in until settings load.
  const blocker = receiptBlocker({ settings: session.settings, recipients: [...fields.to, ...fields.cc, ...fields.bcc], selfAddresses }) ?? (session.settings ? null : draft.trackingBlockedReason ?? null);
  const sendProblem = flow.problem;
  const recipientProblem = sendProblem === "Add at least one recipient.";

  const close = async () => {
    await session.close();
    closeComposer(entry.id);
  };
  closeRef.current = () => void close();
  const discard = async () => {
    await session.discard();
    closeComposer(entry.id);
  };
  const applyTemplate = (t: Template) => {
    if (t.subject && fields.subject.trim() === "") patch({ subject: t.subject });
    body.current?.insertHtml(sanitizeSignatureHtml(t.html));
  };
  const applySignature = (sig: Signature | null) => {
    patch({ signatureId: sig?.id ?? null });
    body.current?.setSignature(sig);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void flow.attempt();
    } else if (e.key === "Escape" && !e.defaultPrevented && !hidden && e.currentTarget.contains(e.target as Node) && !document.querySelector("[role=menu]") && !e.currentTarget.querySelector("[role=listbox]")) {
      e.preventDefault();
      void close();
    }
  };
  const onDrop = (e: DragEvent) => {
    setDragging(false);
    if (e.defaultPrevented || e.dataTransfer.files.length === 0) return;
    e.preventDefault();
    void session.attach(Array.from(e.dataTransfer.files));
  };
  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer.types).includes("Files");

  return (
    <div
      className={styles.panel}
      hidden={hidden}
      role="dialog"
      aria-label="New message"
      onKeyDown={onKeyDown}
      onDragOver={(e) => { if (hasFiles(e)) { e.preventDefault(); setDragging(true); } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false); }}
      onDrop={onDrop}
    >
      <ComposerBar
        fields={fields}
        saveState={session.saveState}
        fromOptions={session.fromOptions}
        templates={session.templates}
        signatures={session.signatures}
        receiptsBlockedReason={blocker}
        aiOpen={aiOpen}
        sending={flow.sending}
        onMinimize={() => minimizeComposer(entry.id)}
        onClose={() => void close()}
        onToggleAi={() => setAiOpen((o) => !o)}
        onAttach={() => fileInput.current?.click()}
        onTemplate={applyTemplate}
        onRemind={(at) => patch({ remindAt: at })}
        onSendLater={(at) => void flow.attempt({ sendAt: at })}
        onToggleTrack={() => patch({ track: !fields.track })}
        onFrom={(o) => body.current?.setSignature(session.chooseFrom(o))}
        onSignature={applySignature}
        onDiscard={() => setConfirmDiscard(true)}
        onSend={() => void flow.attempt()}
      />
      <input ref={fileInput} type="file" multiple hidden onChange={(e) => { void session.attach(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
      <div className={styles.scroll}>
        <div className={styles.page}>
          <input
            className={styles.subject}
            value={fields.subject}
            placeholder="Subject"
            aria-label="Subject"
            spellCheck
            onChange={(e) => patch({ subject: e.target.value })}
          />
          <RecipientField
            label="To"
            value={fields.to}
            autoFocus={draft.mode === "new" && fields.to.length === 0}
            placeholder="To, Cc, Bcc"
            invalid={recipientProblem}
            onChange={(to) => { patch({ to }); if (to.length) flow.clearProblem(); }}
            trailing={
              <>
                {showCc || fields.cc.length ? null : <button type="button" className={styles.reveal} onClick={() => setShowCc(true)}>Cc</button>}
                {showBcc || fields.bcc.length ? null : <button type="button" className={styles.reveal} onClick={() => setShowBcc(true)}>Bcc</button>}
              </>
            }
          />
          {showCc || fields.cc.length ? <RecipientField label="Cc" value={fields.cc} autoFocus={showCc && fields.cc.length === 0} onChange={(cc) => patch({ cc })} /> : null}
          {showBcc || fields.bcc.length ? <RecipientField label="Bcc" value={fields.bcc} autoFocus={showBcc && fields.bcc.length === 0} onChange={(bcc) => patch({ bcc })} /> : null}
          {blocker ? <div className={`t-data ${styles.note}`} role="status"><EyeOff size={12} strokeWidth={1.5} aria-hidden />{blocker}</div> : null}
          {sendProblem ? <div className={`t-data ${styles.error}`} role="alert">{sendProblem}</div> : null}
          {session.error ? <div className={`t-data ${styles.error}`} role="alert">{session.error}</div> : null}
          {aiOpen ? <AiBar body={body} threadId={draft.threadId} draftId={draft.id} to={formatRecipients(fields.to)} subject={fields.subject} onClose={() => setAiOpen(false)} /> : null}
          <AttachmentChips attachments={fields.attachments} pathless={session.pathless} onRemove={(a) => void session.removeAttachment(a)} />
          <div className={styles.body}>
            <BodyEditor
              handleRef={body}
              initialHtml={draft.html}
              autoFocus={draft.mode !== "new" || fields.to.length > 0}
              plainTextOnly={session.settings?.compose.plainTextOnly}
              onChange={(html) => patch({ html })}
              onFiles={(files) => void session.attach(files)}
            />
          </div>
          <QuotedPill html={draft.quotedHtml} />
        </div>
      </div>
      {dragging ? <div className={`t-body ${styles.drop}`}>Drop files to attach</div> : null}
      <Dialog
        open={flow.confirmSubject !== null}
        onClose={flow.dismissConfirm}
        title="Send without a subject?"
        footer={
          <>
            <Button variant="ghost" onClick={flow.dismissConfirm}>Add a subject</Button>
            <Button variant="primary" onClick={() => { const opts = flow.confirmSubject ?? undefined; flow.dismissConfirm(); void flow.attempt(opts?.sendAt ? opts : undefined, true); }}>Send anyway</Button>
          </>
        }
      >
        <p className="t-body" style={{ color: "var(--fg-2)" }}>This message has no subject line.</p>
      </Dialog>
      <Dialog
        open={confirmDiscard}
        onClose={() => setConfirmDiscard(false)}
        title="Discard this draft?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDiscard(false)}>Keep draft</Button>
            <Button variant="danger" onClick={() => void discard()}>Discard</Button>
          </>
        }
      >
        <p className="t-body" style={{ color: "var(--fg-2)" }}>The draft will be deleted.</p>
      </Dialog>
    </div>
  );
}
