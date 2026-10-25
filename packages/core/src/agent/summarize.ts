import type { FlintMethod } from "../api";
import type { Draft } from "../types";

/** Extra data the server looked up before the call (for example the draft being sent). */
export type SummaryContext = { draft?: Draft };

const MAX = 80;

function clip(s: string, max = MAX): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function count(v: unknown): number {
  return Array.isArray(v) ? v.length : 1;
}

function threads(n: number): string {
  return `${n} ${n === 1 ? "thread" : "threads"}`;
}

function addressList(v: unknown): string {
  if (!Array.isArray(v)) return "";
  const list = v.map((a) => (isObj(a) ? str(a.address) : null)).filter((a): a is string => a !== null);
  if (list.length === 0) return "";
  return list.length > 3 ? `${list.slice(0, 3).join(", ")} and ${list.length - 3} more` : list.join(", ");
}

function when(ms: unknown): string {
  if (typeof ms !== "number") return "";
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function humanize(method: string): string {
  const words = method.replace(/([A-Z])/g, " $1").toLowerCase().trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function draftTarget(params: readonly unknown[], result: unknown, ctx: SummaryContext): string {
  const fromDraft = addressList((ctx.draft ?? (isObj(result) ? result : {})).to);
  if (fromDraft) return fromDraft;
  const init = params[0];
  return isObj(init) ? addressList(init.to) : "";
}

/**
 * One human line for Agent Activity. Never includes message bodies.
 * `result` is the value the api method returned.
 */
export function summarize(method: FlintMethod, params: readonly unknown[], result: unknown, ctx: SummaryContext = {}): string {
  const p0 = params[0];
  const n = count(p0);
  switch (method) {
    case "listAccounts": return "Listed accounts";
    case "getSyncStatus": return "Checked sync status";
    case "syncNow": return "Started a sync";
    case "getSidebar": return "Read the sidebar";
    case "getHome": return "Read Home";
    case "listThreads": {
      const q = isObj(p0) ? p0 : {};
      const search = str(q.search);
      if (search) return `Searched for "${clip(search)}"`;
      return `Listed ${str(q.view) ?? "inbox"}`;
    }
    case "getThread": {
      const subject = isObj(result) ? str(result.subject) : null;
      return subject ? `Read thread "${clip(subject)}"` : `Read thread ${String(p0)}`;
    }
    case "getMessage": return `Read message ${String(p0)}`;
    case "allowRemoteImages": return `Loaded remote images in message ${String(p0)}`;
    case "listFolders": return "Listed folders";
    case "saveAttachment": return "Saved an attachment";
    case "suggestContacts": return "Looked up contacts";
    case "markRead": return `Marked ${threads(n)} ${params[1] === false ? "unread" : "read"}`;
    case "setPinned": return `${params[1] === false ? "Unpinned" : "Pinned"} ${threads(n)}`;
    case "archive": return `Archived ${threads(n)}`;
    case "trash": return `Moved ${threads(n)} to trash`;
    case "markSpam": return params[1] === false ? `Marked ${threads(n)} as not spam` : `Marked ${threads(n)} as spam`;
    case "moveToFolder": return `Moved ${threads(n)} to a folder`;
    case "moveToInbox": return `Moved ${threads(n)} to the inbox`;
    case "snooze": return `Snoozed ${threads(n)} until ${when(params[1])}`.trim();
    case "unsnooze": return `Unsnoozed ${threads(n)}`;
    case "setMuted": return `${params[1] === false ? "Unmuted" : "Muted"} ${threads(n)}`;
    case "undo": return "Undid an action";
    case "unsubscribe": return `Unsubscribed from a sender${isObj(result) && str(result.method) ? ` (${String(result.method)})` : ""}`;
    case "blockSender": return `Blocked sender ${clip(String(p0))}`;
    case "unblockSender": return `Unblocked sender ${clip(String(p0))}`;
    case "listBlocked": return "Listed blocked senders";
    case "createDraft": {
      const mode = isObj(p0) ? str(p0.mode) : null;
      if (mode === "reply" || mode === "replyAll") return "Created reply draft";
      if (mode === "forward") return "Created forward draft";
      const to = draftTarget(params, result, ctx);
      return to ? `Created draft to ${to}` : "Created draft";
    }
    case "getDraft": return `Read draft ${String(p0)}`;
    case "updateDraft": return `Updated draft ${String(p0)}`;
    case "deleteDraft": return `Deleted draft ${String(p0)}`;
    case "listDrafts": return "Listed drafts";
    case "addAttachment": return `Attached a file to draft ${String(p0)}`;
    case "removeAttachment": return `Removed an attachment from draft ${String(p0)}`;
    case "sendDraft": {
      const to = draftTarget(params, undefined, ctx);
      const target = to ? ` to ${to}` : "";
      const status = isObj(result) ? result.status : undefined;
      if (status === "awaiting_approval") return `Queued mail${target} for approval`;
      const at = isObj(params[1]) && typeof params[1].sendAt === "number" ? ` for ${when(params[1].sendAt)}` : "";
      return `Queued mail${target}${at}`;
    }
    case "cancelSend": return "Cancelled a queued send";
    case "listScheduled": return "Listed queued mail";
    case "applyRules": return "Applied rules";
    case "listRules": return "Listed rules";
    case "listSignatures": return "Listed signatures";
    case "listTemplates": return "Listed templates";
    case "listTracked": return "Listed read receipts";
    case "getReceipt": return `Read receipt ${String(p0)}`;
    case "refreshReceipts": return "Refreshed read receipts";
    case "stopTracking": return `Stopped tracking ${String(p0)}`;
    case "aiStatus": return "Checked AI status";
    case "aiRun":
    case "aiRunToText": {
      const task = isObj(p0) ? p0 : {};
      const kind = str(task.kind) ?? "task";
      const q = str(task.question);
      return q ? `Asked "${clip(q)}"` : `Ran AI ${kind}`;
    }
    case "aiCancel": return "Cancelled an AI run";
    case "listAgentActivity": return "Listed agent activity";
    default: return humanize(method);
  }
}

/** Summary line for a call that failed. */
export function summarizeFailure(method: string, message: string): string {
  return `${humanize(method)} failed: ${clip(message, 120)}`;
}
