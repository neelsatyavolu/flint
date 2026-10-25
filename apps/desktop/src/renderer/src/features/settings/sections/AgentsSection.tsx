import { useState } from "react";
import { Bot, Pencil, Send, Sparkles, Terminal } from "lucide-react";
import type { AgentSkillStatus } from "@flint/core";
import { flint } from "../../../lib/api";
import { useFlintQuery } from "../../../lib/hooks";
import { Button, SectionLabel, SettingsRow } from "../../../ui";
import { CopyButton } from "../CopyButton";
import { SectionPage, SelectRow, ToggleRow } from "../fields";
import { useSettingsStore } from "../settingsStore";
import { errorText } from "../useAccounts";
import styles from "../settings.module.css";

export const QUICK_START = `flint list --unread --json
flint read <id>
flint draft --to cindy@example.com --subject "Hello" --body "Draft text"`;

export function AgentsSection() {
  const { settings: s, save } = useSettingsStore();
  const info = useFlintQuery((api) => api.agentInfo(), [], { mail: false });
  const [installing, setInstalling] = useState(false);
  const [installMsg, setInstallMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const install = async () => {
    setInstalling(true);
    setInstallMsg(null);
    try {
      const { path } = await flint.installCli();
      setInstallMsg({ ok: true, text: `Installed at ${path}.` });
      info.refetch();
    } catch (err) {
      setInstallMsg({ ok: false, text: errorText(err, "Couldn't install the flint command.") });
    } finally {
      setInstalling(false);
    }
  };

  const skill = useFlintQuery((api) => api.agentSkillStatus(), [], { mail: false });
  const [skillBusy, setSkillBusy] = useState(false);
  const [skillMsg, setSkillMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const changeSkill = async (action: "install" | "remove") => {
    setSkillBusy(true);
    setSkillMsg(null);
    try {
      const next = action === "install" ? await flint.installAgentSkill() : await flint.removeAgentSkill();
      setSkillMsg({ ok: true, text: action === "install" ? skillSummary(next) : "Removed the flint skill from your agents." });
      skill.refetch();
      info.refetch();
    } catch (err) {
      setSkillMsg({ ok: false, text: errorText(err, action === "install" ? "Couldn't add the skill." : "Couldn't remove the skill.") });
    } finally {
      setSkillBusy(false);
    }
  };

  const a = s.agents;
  const d = info.data;
  const sk = skill.data;
  return (
    <SectionPage title="Agents" description="Let local coding agents read and act on your mail through the flint command. Every call is logged in Agent Activity.">
      <ToggleRow icon={<Bot size={18} strokeWidth={1.5} />} title="Allow local agents" description="Turns the command line tool and the local agent API on or off." checked={a.enabled} onChange={(v) => void save({ agents: { enabled: v } })} />
      <SelectRow
        icon={<Pencil size={18} strokeWidth={1.5} />}
        title="Changing mail"
        description="Archive, move, flag and write drafts."
        value={a.modify}
        disabled={!a.enabled}
        choices={[{ value: "allow", label: "Allow" }, { value: "deny", label: "Deny" }]}
        onChange={(v) => void save({ agents: { modify: v } })}
      />
      <SelectRow
        icon={<Send size={18} strokeWidth={1.5} />}
        title="Sending mail"
        description="Ask means the send waits in Agent Activity until you approve it."
        value={a.send}
        disabled={!a.enabled}
        choices={[{ value: "allow", label: "Allow" }, { value: "ask", label: "Ask me first" }, { value: "deny", label: "Deny" }]}
        onChange={(v) => void save({ agents: { send: v } })}
      />
      <SettingsRow icon={<Terminal size={18} strokeWidth={1.5} />} title="flint command" description={d ? (d.cliInstalled ? `Installed${d.cliPath ? ` at ${d.cliPath}` : ""}.` : "Not installed. Installing links it into your path.") : "Checking…"}>
        <Button variant={d?.cliInstalled ? "ghost" : "primary"} onClick={() => void install()} disabled={installing || !d}>
          {d?.cliInstalled ? "Reinstall" : "Install flint command"}
        </Button>
      </SettingsRow>
      {installMsg ? <p role="status" className={installMsg.ok ? styles.ok : styles.err} style={{ paddingTop: 6 }}>{installMsg.text}</p> : null}
      <SettingsRow
        icon={<Sparkles size={18} strokeWidth={1.5} />}
        title="Skill for AI agents"
        description="Adds a flint skill to Claude Code, Codex, Gemini CLI, Grok and the other coding agents on this Mac, so they know how to read, triage and draft your mail with the flint command. Flint keeps it up to date."
      >
        <div className={styles.inline}>
          {sk?.installed ? <Button variant="ghost" onClick={() => void changeSkill("remove")} disabled={skillBusy}>Remove</Button> : null}
          <Button variant={sk?.installed ? "ghost" : "primary"} onClick={() => void changeSkill("install")} disabled={skillBusy || !sk || !sk.targets.some((t) => t.present)}>
            {sk?.installed ? "Update" : "Add to all agents"}
          </Button>
        </div>
      </SettingsRow>
      {skillMsg ? <p role="status" className={skillMsg.ok ? styles.ok : styles.err} style={{ paddingTop: 6 }}>{skillMsg.text}</p> : null}
      {sk ? (
        <div className={styles.stack} aria-label="Agents that get the skill">
          {sk.targets.map((t) => (
            <div key={t.id} className={styles.row}>
              <div className={styles.rowGrow}>
                <div className={styles.fieldLabel}>{t.label}</div>
                <div className={`${styles.mono} ${styles.rowSub}`} style={{ userSelect: "text" }}>{t.path}</div>
              </div>
              <span className={`${styles.mono} ${t.installed ? styles.ok : styles.muted}`}>{t.installed ? "Added" : t.note ? "Skipped" : t.present ? "Not added" : "Not on this Mac"}</span>
            </div>
          ))}
          {sk.targets.filter((t) => t.note).map((t) => <p key={t.id} className={styles.muted}>{t.label}: {t.note}</p>)}
        </div>
      ) : null}

      <div className={styles.group}>
        <SectionLabel className={styles.groupLabel}>Data</SectionLabel>
        <div className={styles.stack}>
          <PathLine label="Socket" value={d?.socketPath} />
          <PathLine label="Token" value={d?.tokenPath} />
        </div>
      </div>

      <div className={styles.group}>
        <div className={styles.inline} style={{ justifyContent: "space-between" }}>
          <SectionLabel>Quick start</SectionLabel>
          <CopyButton text={QUICK_START} />
        </div>
        <code className={styles.code} style={{ marginTop: 6 }}>{QUICK_START}</code>
      </div>
    </SectionPage>
  );
}

function skillSummary(s: AgentSkillStatus): string {
  const added = s.targets.filter((t) => t.installed).map((t) => t.label);
  return added.length ? `Added for ${added.join("; ")}.` : "No coding agents were found on this Mac.";
}

function PathLine({ label, value }: { label: string; value?: string }) {
  return (
    <div className={styles.row}>
      <div className={styles.rowGrow}>
        <div className={styles.fieldLabel}>{label}</div>
        <div className={`${styles.mono} ${styles.rowSub}`} style={{ userSelect: "text" }}>{value ?? "…"}</div>
      </div>
      {value ? <CopyButton text={value} /> : null}
    </div>
  );
}
