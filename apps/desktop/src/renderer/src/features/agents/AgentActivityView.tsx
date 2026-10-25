import { useMemo } from "react";
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
import { groupActivity, scheduledIdOf, statusLabel } from "./activityModel";
import styles from "./AgentActivityView.module.css";

const TONE: Record<AgentActivity["status"], BadgeTone | null> = { ok: null, error: "danger", awaiting_approval: "warn", approved: "ok", denied: "neutral" };

function Row({ item, draftId, onDecide }: { item: AgentActivity; draftId: number | null | undefined; onDecide: (item: AgentActivity, approve: boolean) => void }) {
  const tone = TONE[item.status];
  if (item.status === "awaiting_approval") {
    return <li><ApprovalCard item={item} draftId={draftId} onDecide={(ok) => onDecide(item, ok)} /></li>;
  }
  return (
    <li className={styles.row}>
      <time className={clsx("t-data", styles.time)}>{format(item.at, "h:mm a")}</time>
      <div className={styles.main}>
        <span className={styles.summary}>{item.summary}</span>
        <span className={clsx("t-data", styles.meta)}>{item.agent} · {item.method}</span>
      </div>
      <div className={styles.side}>
        {tone ? <Badge tone={tone}>{statusLabel(item.status)}</Badge> : null}
      </div>
    </li>
  );
}

/** Timeline of every call agents made through the CLI and agent API, with Approve and Deny for queued sends. */
export function AgentActivityView() {
  const toast = useToast();
  const { data, loading, refetch } = useFlintQuery((api) => api.listAgentActivity({ limit: 100 }), [], { refetchOn: ["agent_activity", "send"], mail: false });
  const scheduled = useFlintQuery((api) => api.listScheduled(), [], { refetchOn: ["send"], mail: false });
  const draftOf = (item: AgentActivity): number | null | undefined => {
    if (!scheduled.data) return scheduled.error ? null : undefined;
    const id = scheduledIdOf(item);
    return scheduled.data?.find((s) => s.id === id)?.draftId ?? null;
  };
  const groups = useMemo(() => groupActivity(data ?? [], Date.now(), dateGroupLabel), [data]);

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
  };

  return (
    <div className={styles.view}>
      <PaneHeader title="Agent Activity" subtitle="Everything agents did in your mail">
        <Button size="sm" variant="ghost" onClick={() => navStore.getState().openSettings("agents")}>Agent settings</Button>
      </PaneHeader>
      <div className={styles.scroll}>
        {!data && loading ? (
          <SkeletonRows count={6} density="compact" />
        ) : groups.length === 0 ? (
          <EmptyState title="No agent activity." description="Calls from the flint command and other agents show up here." markSize={48} />
        ) : (
          <div className={styles.column}>
            {groups.map((g) => (
              <section key={g.label} className={styles.group}>
                <SectionLabel className={clsx(styles.groupLabel, g.attention && styles.attention)}>{g.label}</SectionLabel>
                <ul>{g.items.map((i) => <Row key={i.id} item={i} draftId={draftOf(i)} onDecide={(it, ok) => void decide(it, ok)} />)}</ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
