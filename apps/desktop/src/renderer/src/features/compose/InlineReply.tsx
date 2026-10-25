import { useEffect, useRef, useState, type JSX, type KeyboardEvent } from "react";
import { ArrowUpRight, Paperclip, SendHorizontal, Sparkles, X } from "lucide-react";
import { formatRecipients, firstName } from "../../lib/format";
import { useFlintQuery } from "../../lib/hooks";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { IconButton } from "../../ui/IconButton";
import { AiBar } from "../ai/AiBar";
import { AttachmentChips } from "./AttachmentChips";
import { openComposer, releaseDraft } from "./composerStore";
import { BodyEditor, type BodyEditorHandle } from "./editor/BodyEditor";
import { RecipientField } from "./RecipientField";
import { SAVE_LABEL } from "./ComposerBar";
import { useComposerSession } from "./useComposerSession";
import { useSendFlow } from "./useSendFlow";
import styles from "./InlineReply.module.css";

type Props = {
  threadId: number;
  messageId: number;
  mode?: "reply" | "replyAll";
  /** Quick-reply text to start the reply with. Setting it expands the field. */
  seedText?: string;
};

/** One-line "Reply to Cindy…" field that expands into a compact composer. */
export function InlineReply({ threadId, messageId, mode = "reply", seedText }: Props): JSX.Element {
  const [open, setOpen] = useState(false);
  const message = useFlintQuery((api) => api.getMessage(messageId), [messageId]);
  const sender = message.data?.from[0];
  const name = sender ? firstName(sender) : "";

  useEffect(() => setOpen(false), [messageId, threadId]);
  useEffect(() => {
    if (seedText) setOpen(true);
  }, [seedText]);

  if (!open) {
    return (
      <button type="button" className={styles.collapsed} onClick={() => setOpen(true)} aria-label={name ? `Reply to ${name}` : "Reply"}>
        {name ? `Reply to ${name}…` : "Reply…"}
      </button>
    );
  }
  return <Expanded key={`${messageId}:${mode}`} messageId={messageId} mode={mode} seedText={seedText} onDone={() => setOpen(false)} />;
}

function Expanded({ messageId, mode, seedText, onDone }: { messageId: number; mode: "reply" | "replyAll"; seedText?: string; onDone: () => void }): JSX.Element {
  const keyRef = useRef({ id: `inline-${messageId}-${Math.random().toString(36).slice(2)}`, init: { mode, messageId } as const });
  const session = useComposerSession(keyRef.current, { discardEmptyOnUnmount: true });
  const { fields, draft, patch } = session;
  const body = useRef<BodyEditorHandle>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [editTo, setEditTo] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const flow = useSendFlow(session, onDone);
  const seeded = useRef(false);

  useEffect(() => () => releaseDraft(keyRef.current.id), []);
  useEffect(() => {
    if (draft && seedText && !seeded.current) {
      seeded.current = true;
      const t = setTimeout(() => body.current?.insert(seedText), 0);
      return () => clearTimeout(t);
    }
  }, [draft, seedText]);

  if (!fields || !draft) return <div className={styles.open} aria-busy="true"><span className="t-body" style={{ color: "var(--fg-3)" }}>{session.error ?? "Opening reply"}</span></div>;

  const popOut = async () => {
    await session.close();
    openComposer({ draftId: draft.id });
    releaseDraft(keyRef.current.id);
    onDone();
  };
  const collapse = async () => {
    await session.close();
    onDone();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void flow.attempt();
    } else if (e.key === "Escape" && !e.defaultPrevented && !document.querySelector("[role=menu],[role=listbox]")) {
      void collapse();
    }
  };
  const summary = formatRecipients(fields.to);

  return (
    <div className={styles.open} onKeyDown={onKeyDown} role="group" aria-label="Reply">
      {editTo ? (
        <>
          <RecipientField label="To" value={fields.to} compact autoFocus onChange={(to) => { patch({ to }); flow.clearProblem(); }} />
          <RecipientField label="Cc" value={fields.cc} compact onChange={(cc) => patch({ cc })} />
        </>
      ) : (
        <button type="button" className={styles.to} onClick={() => setEditTo(true)} aria-label="Edit recipients">
          <span className={`t-data ${styles.label}`}>To</span>
          <span>{summary || "Add recipients"}{fields.cc.length ? ` · Cc ${formatRecipients(fields.cc)}` : ""}</span>
        </button>
      )}
      {flow.problem ? <div className={`t-data ${styles.err}`} role="alert">{flow.problem}</div> : null}
      {aiOpen ? <AiBar body={body} threadId={draft.threadId} draftId={draft.id} onClose={() => setAiOpen(false)} /> : null}
      <BodyEditor
        handleRef={body}
        initialHtml={draft.html}
        compact
        autoFocus
        label="Reply"
        placeholder="Write a reply"
        plainTextOnly={session.settings?.compose.plainTextOnly}
        onChange={(html) => patch({ html })}
        onFiles={(files) => void session.attach(files)}
      />
      <AttachmentChips attachments={fields.attachments} pathless={session.pathless} onRemove={(a) => void session.removeAttachment(a)} />
      <input ref={fileInput} type="file" multiple hidden onChange={(e) => { void session.attach(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
      <div className={styles.foot}>
        <div className={styles.tools}>
          <IconButton label="+AI" tone="accent" pressed={aiOpen} onClick={() => setAiOpen((o) => !o)}><Sparkles size={18} strokeWidth={1.5} /></IconButton>
          <IconButton label="Attach files" onClick={() => fileInput.current?.click()}><Paperclip size={18} strokeWidth={1.5} /></IconButton>
          <IconButton label="Open in full composer" onClick={() => void popOut()}><ArrowUpRight size={18} strokeWidth={1.5} /></IconButton>
          <IconButton label="Discard reply" onClick={() => setConfirmClose(true)}><X size={18} strokeWidth={1.5} /></IconButton>
          <span className={`t-data ${styles.saved}`} role="status">{SAVE_LABEL[session.saveState]}</span>
        </div>
        <Button variant="primary" size="sm" icon={<SendHorizontal size={16} strokeWidth={1.5} />} disabled={flow.sending} onClick={() => void flow.attempt()}>Send</Button>
      </div>
      <Dialog
        open={flow.confirmSubject !== null}
        onClose={flow.dismissConfirm}
        title="Send without a subject?"
        footer={
          <>
            <Button variant="ghost" onClick={flow.dismissConfirm}>Cancel</Button>
            <Button variant="primary" onClick={() => { flow.dismissConfirm(); void flow.attempt(undefined, true); }}>Send anyway</Button>
          </>
        }
      >
        <p className="t-body" style={{ color: "var(--fg-2)" }}>This reply has no subject line.</p>
      </Dialog>
      <Dialog
        open={confirmClose}
        onClose={() => setConfirmClose(false)}
        title="Discard this reply?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmClose(false)}>Keep editing</Button>
            <Button variant="danger" onClick={() => { void session.discard().then(onDone); }}>Discard</Button>
          </>
        }
      >
        <p className="t-body" style={{ color: "var(--fg-2)" }}>The reply will be deleted.</p>
      </Dialog>
    </div>
  );
}
