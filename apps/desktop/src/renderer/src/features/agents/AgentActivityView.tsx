import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { format } from "date-fns";
import clsx from "clsx";
import type { AgentActivity } from "@flint/core";
import { flint } from "../../lib/api";
import { useFlintQuery } from "../../lib/hooks";
import { dateGroupLabel } from "../../lib/format";
import { Badge, Button, EmptyState, SectionLabel, SkeletonRows, useToast, type BadgeTone } from "../../ui";
import { PaneHeader } from "../../shell/PaneHeader";
import { navStore } from "../../state/nav";
import { ApprovalCard } from "./ApprovalCard";
import { describeReads, foldReads, groupActivity, scheduledIdOf, statusLabel, withPending, type ActivityEntry } from "./activityModel";
import styles from "./AgentActivityView.module.css";

const TONE: Record<AgentActivity["status"], BadgeTone | null> = { ok: null, error: "danger", awaiting_approval: "warn", approved: "ok", denied: "neutral" };

type Decide = (item: AgentActivity, approve: boolean) => void;

function CallRow({ item }: { item: AgentActivity }) {
  const tone = TONE[item.status];
  return (
    <li className={styles.row} title={item.method}>
      <time className={clsx("t-data", styles.time)}>{format(item.at, "h:mm a")}</time>
      <span className={styles.summary}>{item.summary}</span>
      {tone ? <Badge tone={tone}>{statusLabel(item.status)}</Badge> : null}
      <span className={clsx("t-data", styles.agent)}>{item.agent}</span>
    </li>
  );
}

/** A burst of reads as one quiet line; opens to show each call. */
function ReadsRow({ agent, items }: { agent: string; items: AgentActivity[] }) {
  const [open, setOpen] = useState(false);
  return (
    <li className={styles.reads}>
      <button type="button" className={styles.row} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <time className={clsx("t-data", styles.time)}>{format(items[0]!.at, "h:mm a")}</time>
        <span className={clsx(styles.summary, styles.quiet)}>{describeReads(items)}</span>
        <span className={clsx("t-data", styles.count)}>
          {items.length} reads
          <ChevronRight size={14} strokeWidth={1.5} className={clsx(styles.chevron, open && styles.turned)} />
        </span>
        <span className={clsx("t-data", styles.agent)}>{agent}</span>
      </button>
      {open ? (
        <ul className={styles.calls}>
          {items.map((i) => (
            <li key={i.id} className={styles.call} title={i.method}>
              <time className={clsx("t-data", styles.time)}>{format(i.at, "h:mm:ss a")}</time>
              <span className={styles.summary}>{i.summary}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function Entry({ entry, draftOf, onDecide }: { entry: ActivityEntry; draftOf: (item: AgentActivity) => number | null | undefined; onDecide: Decide }) {
  if (entry.kind === "reads") return <ReadsRow agent={entry.agent} items={entry.items} />;
  const { item } = entry;
  if (item.status === "awaiting_approval") {
    return <li><ApprovalCard item={item} draftId={draftOf(item)} onDecide={(ok) => onDecide(item, ok)} /></li>;
  }
  return <CallRow item={item} />;
}

/** Timeline of every call agents made through the CLI and agent API, with Approve and Deny for queued sends. */
export function AgentActivityView() {
  const toast = useToast();
  const { data, error, loading, refetch } = useFlintQuery((api) => api.listAgentActivity({ limit: 100 }), [], { refetchOn: ["agent_activity", "send"], mail: false });
  // Pending approvals load on their own so a long run of reads can't push them off the recent page.
  const pending = useFlintQuery((api) => api.listAgentActivity({ status: "awaiting_approval", limit: 500 }), [], { refetchOn: ["agent_activity", "send"], mail: false });
  const scheduled = useFlintQuery((api) => api.listScheduled(), [], { refetchOn: ["send"], mail: false });
  const draftOf = (item: AgentActivity): number | null | undefined => {
    if (!scheduled.data) return scheduled.error ? null : undefined;
    const id = scheduledIdOf(item);
    return scheduled.data?.find((s) => s.id === id)?.draftId ?? null;
  };
  const groups = useMemo(() => groupActivity(withPending(data ?? [], pending.data ?? []), Date.now(), dateGroupLabel), [data, pending.data]);

  const decide = async (item: AgentActivity, approve: boolean) => {
    const id = scheduledIdOf(item);
    try {
      if (id === null) throw new Error("missing send id");
      await flint.approveSend(id, approve);
      toast.show({ message: approve ? "Approved. The mail will send." : "Denied. Nothing was sent, and the draft stays in Drafts." });
    } catch {
      toast.show({ message: "Couldn't update that send. Check Scheduled and try again.", level: "error" });
    }
    refetch();
    pending.refetch();
  };

  return (
    <div className={styles.view}>
      <PaneHeader className={styles.header} title="Agent activity" subtitle="Everything agents did in your mail">
        <Button size="sm" variant="ghost" onClick={() => navStore.getState().openSettings("agents")}>Agent settings</Button>
      </PaneHeader>
      <div className={styles.scroll}>
        {!data && loading ? (
          <SkeletonRows count={6} density="compact" />
        ) : !data && error ? (
          <EmptyState
            title="Couldn't load agent activity."
            description={error.message}
            action={<Button size="sm" variant="secondary" onClick={refetch}>Try again</Button>}
            markSize={48}
          />
        ) : groups.length === 0 ? (
          <EmptyState title="No agent activity." description="Calls from the flint command and other agents show up here." markSize={48} />
        ) : (
          <div className={styles.column}>
            {groups.map((g) => (
              <section key={g.label} className={styles.group}>
                <SectionLabel rule className={clsx(styles.groupLabel, g.attention && styles.attention)}>{g.label}</SectionLabel>
                <ul>{foldReads(g.items).map((e) => <Entry key={e.kind === "call" ? e.item.id : `r${e.items[0]!.id}`} entry={e} draftOf={draftOf} onDecide={(it, ok) => void decide(it, ok)} />)}</ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
