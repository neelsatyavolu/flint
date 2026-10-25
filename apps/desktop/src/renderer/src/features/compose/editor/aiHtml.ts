const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Turns AI output (plain paragraphs, blank-line separated) into body HTML. */
export function aiTextToHtml(text: string): string {
  const paragraphs = text.trim().split(/\n{2,}/).filter((p) => p.trim() !== "");
  return paragraphs.map((p) => `<p>${esc(p.trim()).replace(/\n/g, "<br>")}</p>`).join("");
}
