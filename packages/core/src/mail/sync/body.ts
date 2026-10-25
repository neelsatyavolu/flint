import type { FetchMessageObject, ImapFlow, MessageStructureObject } from "imapflow";
import { simpleParser } from "mailparser";
import type { MessageBody } from "../../store/types";
import { walkStructure, type TextPart } from "./bodystructure";

/** Largest slice of one text part we download. */
export const MAX_PART_BYTES = 4 * 1024 * 1024;

/** Decodes one raw body part (transfer encoding and charset) by wrapping it in a minimal message for mailparser. */
export async function decodeTextPart(raw: Buffer, part: TextPart): Promise<string> {
  const charset = part.charset ? `; charset="${part.charset.replace(/"/g, "")}"` : "";
  const head = `MIME-Version: 1.0\r\nContent-Type: ${part.type}${charset}\r\nContent-Transfer-Encoding: ${part.encoding}\r\n\r\n`;
  const parsed = await simpleParser(Buffer.concat([Buffer.from(head, "latin1"), raw]));
  return part.type === "text/html" ? (typeof parsed.html === "string" ? parsed.html : "") : (parsed.text ?? "");
}

/**
 * Downloads the text and html bodies of one message. The mailbox must be selected (hold a lock).
 * Pass the BODYSTRUCTURE when it is already known to save a round trip.
 */
export async function loadBody(client: ImapFlow, uid: number, structure?: MessageStructureObject): Promise<MessageBody | null> {
  let tree = structure;
  if (!tree) {
    const s = await client.fetchOne(String(uid), { bodyStructure: true }, { uid: true });
    if (!s) return null;
    tree = s.bodyStructure;
  }
  const info = walkStructure(tree);
  if (info.text.length === 0) return { text: null, html: null };
  const msg: FetchMessageObject | false = await client.fetchOne(
    String(uid),
    { bodyParts: info.text.map((p) => ({ key: p.part, maxLength: MAX_PART_BYTES })) },
    { uid: true },
  );
  if (!msg) return null;
  const texts: string[] = [];
  const htmls: string[] = [];
  for (const part of info.text) {
    const raw = msg.bodyParts?.get(part.part) ?? msg.bodyParts?.get(part.part.toLowerCase());
    if (!raw) continue;
    const decoded = await decodeTextPart(raw, part);
    (part.type === "text/html" ? htmls : texts).push(decoded);
  }
  return { text: texts.length ? texts.join("\n\n") : null, html: htmls.length ? htmls.join("\n") : null };
}
