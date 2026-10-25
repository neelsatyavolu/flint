import type { JSX } from "react";

type Block = { kind: "p"; text: string } | { kind: "ul"; items: string[] };

/** Splits AI output into paragraphs and "- " bullet lists. Plain text only; nothing is parsed as HTML. */
export function toBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  for (const line of text.replace(/\r/g, "").split("\n")) {
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const last = blocks.at(-1);
    if (bullet) {
      if (last?.kind === "ul") last.items.push(bullet[1]!);
      else blocks.push({ kind: "ul", items: [bullet[1]!] });
    } else if (line.trim() === "") {
      blocks.push({ kind: "p", text: "" });
    } else if (last?.kind === "p" && last.text !== "") {
      last.text += `\n${line.trim()}`;
    } else if (last?.kind === "p" && last.text === "") {
      last.text = line.trim();
    } else {
      blocks.push({ kind: "p", text: line.trim() });
    }
  }
  return blocks.filter((b) => b.kind === "ul" || b.text !== "");
}

/** AI or mail prose in the Prose type role. */
export function ProseText({ text, className }: { text: string; className?: string }): JSX.Element {
  return (
    <div className={`t-prose ${className ?? ""}`} style={{ userSelect: "text", WebkitUserSelect: "text" }}>
      {toBlocks(text).map((b, i) =>
        b.kind === "p" ? (
          <p key={i} style={{ margin: "0 0 8px", whiteSpace: "pre-line" }}>{b.text}</p>
        ) : (
          <ul key={i} style={{ margin: "0 0 8px", paddingLeft: 20, listStyle: "disc" }}>
            {b.items.map((it, j) => <li key={j}>{it}</li>)}
          </ul>
        ),
      )}
    </div>
  );
}
