import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "../../ui";

/** Copies text to the clipboard. Falls back silently when the clipboard is unavailable. */
export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    } catch {
      setDone(false);
    }
  };
  return (
    <Button variant="ghost" size="sm" icon={done ? <Check size={14} strokeWidth={1.5} /> : <Copy size={14} strokeWidth={1.5} />} onClick={() => void copy()}>
      {done ? "Copied" : label}
    </Button>
  );
}
