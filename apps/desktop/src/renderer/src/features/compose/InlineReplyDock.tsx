import { useContext, useEffect, useRef, useState, type JSX, type KeyboardEvent } from "react";
import { EyeOff } from "lucide-react";
import clsx from "clsx";
import type { Signature, Template } from "@flint/core";
import { useInlineReply } from "../../state/inlineReply";
import { AppContext } from "../../state/AppContext";
import { formatRecipients } from "../../lib/format";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { AiBar } from "../ai/AiBar";
import { AttachmentChips } from "./AttachmentChips";
import { openComposer, releaseDraft } from "./composerStore";
import { BodyEditor, type BodyEditorHandle } from "./editor/BodyEditor";
import { sanitizeSignatureHtml } from "./editor/sanitize";
import { FOCUS_REPLY_EVENT, type InlineReplyCloseResult, type InlineReplyDockProps } from "./inlineReplyTypes";
import { QuotedPill } from "./QuotedPill";
import { receiptBlocker } from "./receiptNote";
import { RecipientField } from "./RecipientField";
import { ReplyHeader } from "./ReplyHeader";
import { ReplyToolbar } from "./ReplyToolbar";
import { useComposerSession } from "./useComposerSession";
import { NO_ATTACHMENT, NO_RECIPIENTS, useSendFlow } from "./useSendFlow";
import styles from "./InlineReplyDock.module.css";

/**
 * The docked reply composer the reader mounts at the bottom of the thread. A new request nonce starts a fresh
 * session; the dock calls onClose exactly once, when it is sent, closed, discarded or expanded.
 */
export function InlineReplyDock({ request, onClose }: InlineReplyDockProps): JSX.Element {
  return <Dock key={request.nonce} request={request} onClose={onClose} />;
}

function Dock({ request, onClose }: InlineReplyDockProps): JSX.Element {
  const keyRef = useRef({
    id: `dock-${request.nonce}-${Math.random().toString(36).slice(2)}`,
    init: request.draftId !== undefined ? ({ draftId: request.draftId } as const) : ({ mode: request.mode, messageId: request.messageId } as const),
  });
  const session = useComposerSession(keyRef.current, { discardEmptyOnUnmount: true });
  const { fields, draft, patch } = session;
  const root = useRef<HTMLElement>(null);
  const body = useRef<BodyEditorHandle>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [showCc, setShowCc] = useState(false);
  const [showBcc, setShowBcc] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [sendLaterOpen, setSendLaterOpen] = useState(false);
  const finished = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const finish = (result: InlineReplyCloseResult) => {
    if (finished.current) return;
    finished.current = true;
    releaseDraft(keyRef.current.id);
    useInlineReply.getState().setLiveDraft(null);
    onCloseRef.current(result);
  };
  const flow = useSendFlow(session, () => finish({ draftId: null, reason: "sent" }));
  const selfAddresses = useContext(AppContext)?.selfAddresses ?? [];
  const seeded = useRef(false);

  useEffect(() => {
    useInlineReply.getState().setLiveDraft(draft?.id ?? null);
  }, [draft?.id]);
  // The editor is what the reply is for: make sure it has focus once it exists, so single-key shortcuts
  // (archive, reply) can never fire while the reader types. A forward still waiting for recipients focuses To instead.
  const wantsBodyFocus = !!draft && (draft.mode !== "forward" || (fields?.to.length ?? 0) > 0);
  useEffect(() => {
    if (!draft || !wantsBodyFocus) return;
    const t = setTimeout(() => {
      const a = document.activeElement;
      const inField = a instanceof HTMLElement && root.current?.contains(a) && a.matches("input,textarea,[contenteditable='true']");
      if (!inField) body.current?.focus();
    }, 30);
    return () => clearTimeout(t);
    // Once per draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.id]);
  useEffect(() => {
    const focus = () => body.current?.focus();
    window.addEventListener(FOCUS_REPLY_EVENT, focus);
    return () => window.removeEventListener(FOCUS_REPLY_EVENT, focus);
  }, []);
  useEffect(() => {
    if (draft && request.seedText && request.draftId === undefined && !seeded.current) {
      seeded.current = true;
      const t = setTimeout(() => body.current?.insert(request.seedText!), 0);
      return () => clearTimeout(t);
    }
  }, [draft, request.seedText, request.draftId]);

  if (!fields || !draft) {
    return (
      <section className={clsx(styles.dock, styles.loading)} aria-busy="true" aria-label="Reply">
        <span className="t-body" style={{ color: "var(--fg-3)" }}>{session.error ?? "Opening reply"}</span>
      </section>
    );
  }

  const blocker = receiptBlocker({ settings: session.settings, recipients: [...fields.to, ...fields.cc, ...fields.bcc], selfAddresses }) ?? (session.settings ? null : draft.trackingBlockedReason ?? null);
  const recipientProblem = flow.problem === NO_RECIPIENTS;
  const attachStop = flow.confirm?.stop === "no_attachment";
  const forward = draft.mode === "forward";

  const close = async () => {
    const kept = await session.close();
    finish({ draftId: kept ? draft.id : null, reason: "closed" });
  };
  const expand = async () => {
    session.keep();
    await session.flush();
    openComposer({ draftId: draft.id });
    releaseDraft(keyRef.current.id);
    finish({ draftId: draft.id, reason: "expanded" });
  };
  const discard = async () => {
    await session.discard();
    finish({ draftId: null, reason: "discarded" });
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
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && e.shiftKey) {
      e.preventDefault();
      setSendLaterOpen(true);
    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void flow.attempt();
    } else if (e.key === "Escape" && !document.querySelector("[role=menu],[role=listbox]:not([aria-label=Conversations]),[role=dialog]")) {
      e.preventDefault();
      e.stopPropagation();
      void close();
    }
  };

  return (
    <>
      <section ref={root} className={styles.dock} onKeyDown={onKeyDown} aria-label="Reply">
        <ReplyHeader title={fields.subject.trim() || "No subject"} onExpand={() => void expand()} onClose={() => void close()} />
        <div className={styles.fields}>
          <RecipientField
            label="To"
            value={fields.to}
            compact
            autoFocus={forward && fields.to.length === 0}
            invalid={recipientProblem}
            onChange={(to) => { patch({ to }); if (to.length) flow.clearProblem(); }}
            trailing={
              <>
                {showCc || fields.cc.length ? null : <button type="button" className={styles.reveal} onClick={() => setShowCc(true)}>Cc</button>}
                {showBcc || fields.bcc.length ? null : <button type="button" className={styles.reveal} onClick={() => setShowBcc(true)}>Bcc</button>}
              </>
            }
          />
          {showCc || fields.cc.length ? <RecipientField label="Cc" value={fields.cc} compact autoFocus={showCc && fields.cc.length === 0} onChange={(cc) => patch({ cc })} /> : null}
          {showBcc || fields.bcc.length ? <RecipientField label="Bcc" value={fields.bcc} compact autoFocus={showBcc && fields.bcc.length === 0} onChange={(bcc) => patch({ bcc })} /> : null}
        </div>
        {blocker ? <div className={`t-data ${styles.note}`} role="status"><EyeOff size={12} strokeWidth={1.5} aria-hidden />{blocker}</div> : null}
        {flow.problem ? <div className={`t-data ${styles.err}`} role="alert">{flow.problem}</div> : null}
        {session.error ? <div className={`t-data ${styles.err}`} role="alert">{session.error}</div> : null}
        {aiOpen ? <AiBar body={body} threadId={draft.threadId} draftId={draft.id} to={formatRecipients(fields.to)} subject={fields.subject} onClose={() => setAiOpen(false)} /> : null}
        <div className={styles.body}>
          <BodyEditor
            handleRef={body}
            initialHtml={draft.html}
            compact
            autoFocus={!forward || fields.to.length > 0}
            label="Reply"
            placeholder={forward ? "Add a note" : "Write a reply"}
            plainTextOnly={session.settings?.compose.plainTextOnly}
            onChange={(html) => patch({ html })}
            onFiles={(files) => void session.attach(files)}
          />
        </div>
        <AttachmentChips attachments={fields.attachments} pathless={session.pathless} onRemove={(a) => void session.removeAttachment(a)} />
        <QuotedPill html={draft.quotedHtml} />
        <input ref={fileInput} type="file" multiple hidden onChange={(e) => { void session.attach(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
        <ReplyToolbar
          fields={fields}
          saveState={session.saveState}
          fromOptions={session.fromOptions}
          templates={session.templates}
          signatures={session.signatures}
          receiptsBlockedReason={blocker}
          aiOpen={aiOpen}
          sending={flow.sending}
          onToggleAi={() => setAiOpen((o) => !o)}
          onAttach={() => fileInput.current?.click()}
          onTemplate={applyTemplate}
          onRemind={(at) => patch({ remindAt: at })}
          onSendLater={(at) => void flow.attempt({ sendAt: at })}
          sendLaterOpen={sendLaterOpen}
          onSendLaterOpenChange={setSendLaterOpen}
          onToggleTrack={() => patch({ track: !fields.track })}
          onFrom={(o) => body.current?.setSignature(session.chooseFrom(o))}
          onSignature={applySignature}
          onDiscard={() => setConfirmDiscard(true)}
          onSend={() => void flow.attempt()}
        />
        <Dialog
          open={flow.confirm !== null}
          onClose={flow.dismissConfirm}
          title={attachStop ? NO_ATTACHMENT.title : "Send without a subject?"}
          footer={
            <>
              {attachStop ? (
                <Button variant="ghost" onClick={() => { flow.dismissConfirm(); fileInput.current?.click(); }}>Attach a file</Button>
              ) : (
                <Button variant="ghost" onClick={flow.dismissConfirm}>Cancel</Button>
              )}
              <Button variant="primary" onClick={flow.confirmSend}>Send anyway</Button>
            </>
          }
        >
          <p className="t-body" style={{ color: "var(--fg-2)" }}>{attachStop ? NO_ATTACHMENT.body : "This reply has no subject line."}</p>
        </Dialog>
        <Dialog
          open={confirmDiscard}
          onClose={() => setConfirmDiscard(false)}
          title="Discard this reply?"
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirmDiscard(false)}>Keep editing</Button>
              <Button variant="danger" onClick={() => { setConfirmDiscard(false); void discard(); }}>Discard</Button>
            </>
          }
        >
          <p className="t-body" style={{ color: "var(--fg-2)" }}>The reply will be deleted.</p>
        </Dialog>
      </section>
    </>
  );
}
