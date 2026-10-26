import { FlintError, type Invite, type InviteResponse, type RsvpResponse } from "@flint/core/types";
import { emit, parseId, parseLimit, resolveAccountId, type Ctx } from "../ctx";
import { renderTable } from "../table";
import { formatFull } from "../time";

const ANSWERS: Record<string, RsvpResponse> = { yes: "accepted", maybe: "tentative", no: "declined" };
const WORDS: Record<InviteResponse, string> = { accepted: "yes", tentative: "maybe", declined: "no", "needs-action": "no answer" };

function when(start: number, end: number, allDay: boolean, startDate: string | null): string {
  return allDay && startDate ? `${startDate} all day` : `${formatFull(start)}${end > start ? ` (${Math.round((end - start) / 60_000)} min)` : ""}`;
}

export async function invites(ctx: Ctx, opts: { account?: string; limit?: string; all?: boolean }): Promise<void> {
  const accountId = await resolveAccountId(ctx, opts.account);
  const list = await ctx.client.listInvites({ ...(accountId ? { accountId } : {}), limit: parseLimit(opts.limit, 25) });
  emit(ctx, list, (l) => l.length === 0 ? "No upcoming invitations." : renderTable(
    ["THREAD", "WHEN", "YOU", "TITLE", "FROM"],
    l.map((i) => [String(i.threadId), when(i.invite.start, i.invite.end, i.invite.allDay, i.invite.startDate), WORDS[i.invite.yourResponse], i.invite.title, i.invite.organizerName ?? ""]),
    { width: ctx.width, style: ctx.style },
  ));
}

function whyNot(invite: Invite): string {
  switch (invite.state) {
    case "cancelled": return "the event was cancelled";
    case "past": return "the event is over";
    case "superseded": return "a newer version of the invitation exists";
    case "reply": return "it is a reply to an invitation you sent";
    case "counter": return "it is a proposal, not an invitation";
    default: return invite.invitedAs ? "it takes no answer" : "you are not on the guest list";
  }
}

export async function rsvp(ctx: Ctx, idRaw: string, answerRaw: string, opts: { note?: string }): Promise<void> {
  const answer = ANSWERS[answerRaw.toLowerCase()];
  if (!answer) throw new FlintError("invalid", `Answer yes, maybe or no, not "${answerRaw}".`);
  const threadId = parseId(idRaw);
  const thread = await ctx.client.getThread(threadId);
  const withInvite = thread.messages.filter((m) => m.invite).sort((a, b) => b.date - a.date);
  if (withInvite.length === 0) throw new FlintError("not_found", `Thread ${threadId} has no calendar invitation.`);
  const target = withInvite.find((m) => m.invite && m.invite.rsvpVia !== "none");
  if (!target?.invite) {
    const latest = withInvite[0]?.invite;
    throw new FlintError("invalid", `Can't answer the invitation in thread ${threadId}: ${latest ? whyNot(latest) : "no invitation"}.`);
  }
  const done = await ctx.client.rsvp(target.id, answer, opts.note);
  emit(ctx, done, (i) => `You answered ${WORDS[answer]} to "${i.title}" (${when(i.start, i.end, i.allDay, i.startDate)}).`);
}
