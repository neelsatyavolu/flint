const DAY = 86_400_000;

export type ReminderPreset = { id: "1d" | "3d" | "1w"; label: string; at: number };

/** "Remind me if no reply in" presets, measured from now. */
export function reminderPresets(now: number): ReminderPreset[] {
  return [
    { id: "1d", label: "1 day", at: now + DAY },
    { id: "3d", label: "3 days", at: now + 3 * DAY },
    { id: "1w", label: "1 week", at: now + 7 * DAY },
  ];
}
