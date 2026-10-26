// A small, forgiving XML reader for WebDAV/CalDAV multistatus answers. Namespaces are ignored: elements are matched by
// local name ("href", "calendar-data"), which is all CalDAV needs and what makes `D:`, `d:`, `ns0:` and default-namespace
// answers (iCloud, Fastmail, Nextcloud, Radicale) read the same way.

export type XNode = { name: string; attrs: Record<string, string>; children: XNode[]; text: string };

const ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

const local = (qname: string): string => {
  const i = qname.indexOf(":");
  return (i >= 0 ? qname.slice(i + 1) : qname).toLowerCase();
};

const TOKEN = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/([^\s>]+)\s*>|<([^\s/>]+)((?:\s+[^\s=>/]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/gi;
const ATTR = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/** Parses a document into a tree. Throws on text that has no element at all. */
export function parseXml(src: string): XNode {
  const root: XNode = { name: "#document", attrs: {}, children: [], text: "" };
  const stack: XNode[] = [root];
  for (const m of src.matchAll(TOKEN)) {
    const top = stack[stack.length - 1]!;
    if (m[1] !== undefined) top.text += m[1];
    else if (m[2] !== undefined) {
      // Close up to the matching open element; stray closers are ignored.
      const name = local(m[2]);
      for (let i = stack.length - 1; i > 0; i--) if (stack[i]!.name === name) { stack.length = i; break; }
    } else if (m[3] !== undefined) {
      const attrs: Record<string, string> = {};
      for (const a of (m[4] ?? "").matchAll(ATTR)) attrs[local(a[1]!)] = decodeEntities(a[2] ?? a[3] ?? "");
      const node: XNode = { name: local(m[3]), attrs, children: [], text: "" };
      top.children.push(node);
      if (m[5] !== "/") stack.push(node);
    } else if (m[6] !== undefined) top.text += decodeEntities(m[6]);
  }
  const first = root.children[0];
  if (!first) throw new Error("not XML");
  return first;
}

/** First descendant reached by following the local names in order, or null. */
export function path(node: XNode | null | undefined, ...names: string[]): XNode | null {
  let cur: XNode | null | undefined = node;
  for (const n of names) {
    cur = cur?.children.find((c) => c.name === n);
    if (!cur) return null;
  }
  return cur ?? null;
}

export const kids = (node: XNode | null | undefined, name: string): XNode[] => node?.children.filter((c) => c.name === name) ?? [];
export const textOf = (node: XNode | null | undefined): string => (node?.text ?? "").trim();
/** Every descendant (any depth) with this local name. */
export function descendants(node: XNode, name: string, out: XNode[] = []): XNode[] {
  for (const c of node.children) {
    if (c.name === name) out.push(c);
    descendants(c, name, out);
  }
  return out;
}
