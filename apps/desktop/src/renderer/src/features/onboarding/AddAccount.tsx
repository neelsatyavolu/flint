import { useState, type JSX } from "react";
import { ArrowLeft, Mail } from "lucide-react";
import type { Account } from "@flint/core";
import { Button, FlintMark } from "../../ui";
import { GoogleStep } from "./GoogleStep";
import { ImapStep } from "./ImapStep";
import { PROVIDERS, presetById, type ProviderId } from "./providers";
import styles from "./onboarding.module.css";

type Choice = "choose" | "google" | ProviderId;

const DESCRIPTIONS: Record<ProviderId, string> = {
  "gmail-app": "Needs 2-Step Verification and an app password.",
  icloud: "Uses an app-specific password.",
  outlook: "Outlook.com, Hotmail and Office 365.",
  yahoo: "Uses an app password.",
  fastmail: "Uses an app password.",
  other: "Any provider that supports IMAP.",
};

type Props = {
  onDone: (account: Account) => void;
  onCancel?: () => void;
  welcome?: boolean;
  /** Sign in again to an existing password account. Opens straight at the password form. */
  reauth?: Account;
};

export function AddAccount({ onDone, onCancel, welcome, reauth }: Props): JSX.Element {
  const [choice, setChoice] = useState<Choice>(reauth ? (reauth.provider === "gmail" ? "gmail-app" : "other") : "choose");
  const heading = welcome ? (choice === "choose" ? "Add your first account" : "Add account") : null;

  const body = (
    <div className={styles.step}>
      {choice !== "choose" && !reauth ? (
        <Button variant="ghost" size="sm" className={styles.back} icon={<ArrowLeft size={14} strokeWidth={1.5} />} onClick={() => setChoice("choose")}>All providers</Button>
      ) : null}
      {choice === "choose" ? <Choices onPick={setChoice} /> : null}
      {choice === "google" ? <GoogleStep onDone={onDone} /> : null}
      {choice !== "choose" && choice !== "google" ? <ImapStep key={choice} preset={presetById(choice)} reauth={reauth} onDone={onDone} /> : null}
      {onCancel ? <div className={styles.actions}><Button variant="ghost" onClick={onCancel}>Cancel</Button></div> : null}
    </div>
  );

  if (!welcome) return body;
  return (
    <div className={styles.welcome}>
      <div className={styles.welcomeInner}>
        <header className={styles.hero}>
          <FlintMark size={56} spark className={styles.mark} />
          <h1 className="t-compose">{heading}</h1>
          {choice === "choose" ? <p className={styles.lede}>Flint is a free mail client. Your mail stays on this computer, and nothing is sent to us.</p> : null}
        </header>
        {body}
      </div>
    </div>
  );
}

function Choices({ onPick }: { onPick: (c: Choice) => void }) {
  return (
    <div className={styles.choices} role="list">
      <button type="button" role="listitem" className={styles.choice} onClick={() => onPick("google")}>
        <span className={styles.choiceIcon} aria-hidden><Mail size={18} strokeWidth={1.5} /></span>
        <span className={styles.choiceText}>
          <span className={styles.choiceTitle} style={{ display: "block" }}>Sign in with Google</span>
          <span className={styles.choiceDesc} style={{ display: "block" }}>Gmail and Google Workspace, with Google's own sign-in.</span>
        </span>
      </button>
      {PROVIDERS.map((p) => (
        <button key={p.id} type="button" role="listitem" className={styles.choice} onClick={() => onPick(p.id)}>
          <span className={styles.choiceIcon} aria-hidden><Mail size={18} strokeWidth={1.5} /></span>
          <span className={styles.choiceText}>
            <span className={styles.choiceTitle} style={{ display: "block" }}>{p.label}</span>
            <span className={styles.choiceDesc} style={{ display: "block" }}>{DESCRIPTIONS[p.id]}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
