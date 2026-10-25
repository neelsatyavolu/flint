import type { MessageStructureObject } from "imapflow";
import type { IngestAttachment } from "../../store/types";

export type TextPart = { part: string; type: "text/plain" | "text/html"; charset: string | null; encoding: string };
export type StructureInfo = { text: TextPart[]; attachments: IngestAttachment[] };

const EXT: Record<string, string> = { jpeg: "jpg", "svg+xml": "svg", plain: "txt", calendar: "ics", "x-icon": "ico" };

function nameOf(node: MessageStructureObject): string {
  return node.dispositionParameters?.["filename"] ?? node.parameters?.["name"] ?? "";
}

function stripBrackets(id: string | undefined): string | null {
  const clean = (id ?? "").replace(/^<|>$/g, "").trim();
  return clean || null;
}

function fallbackName(node: MessageStructureObject, part: string, inline: boolean): string {
  const sub = node.type.split("/")[1] ?? "bin";
  return `${inline ? "inline" : "attachment"}-${part}.${EXT[sub] ?? sub.replace(/[^a-z0-9]/gi, "")}`;
}

/**
 * Splits a BODYSTRUCTURE into text bodies (plain and html, in order) and attachments.
 * Embedded messages are attachments and are not descended into.
 */
export function walkStructure(root: MessageStructureObject | undefined): StructureInfo {
  const info: StructureInfo = { text: [], attachments: [] };
  if (!root) return info;
  const visit = (node: MessageStructureObject, part: string): void => {
    const type = node.type.toLowerCase();
    if (type.startsWith("multipart/") || (node.childNodes?.length && type !== "message/rfc822")) {
      (node.childNodes ?? []).forEach((child, i) => visit(child, part === "" ? String(i + 1) : `${part}.${i + 1}`));
      return;
    }
    const leaf = part === "" ? "1" : part;
    const disposition = (node.disposition ?? "").toLowerCase();
    const filename = nameOf(node);
    if ((type === "text/plain" || type === "text/html") && disposition !== "attachment" && !filename) {
      info.text.push({ part: leaf, type, charset: node.parameters?.["charset"] ?? null, encoding: (node.encoding ?? "7bit").toLowerCase() });
      return;
    }
    const contentId = stripBrackets(node.id);
    const inline = contentId !== null && disposition !== "attachment";
    info.attachments.push({
      part: leaf, filename: filename || fallbackName(node, leaf, inline), contentType: type, size: node.size ?? 0, contentId, inline,
    });
  };
  visit(root, "");
  return info;
}

export const hasRealAttachments = (info: StructureInfo): boolean => info.attachments.some((a) => !a.inline);
