import { Node } from "@tiptap/react";
import { sanitizeSignatureHtml } from "./sanitize";

import { CORE_SIGNATURE_CLASS, SIGNATURE_CLASS } from "../signature";

/**
 * The signature block. It is an atom to ProseMirror (so rich layouts such as tables survive) whose node view
 * contains its own editable region. The saved HTML is `<div class="flint_signature" data-signature-id="N">…</div>`,
 * the same shape the backend writes into new drafts. The hairline above it is view-only: the signature is sent
 * exactly as written, so a "--" divider only appears when the signature itself has one (as Spark's do).
 */
export const Signature = Node.create({
  name: "signature",
  group: "block",
  atom: true,
  selectable: false,
  draggable: false,

  addAttributes() {
    return { signatureId: { default: null }, html: { default: "" } };
  },

  parseHTML() {
    return [
      {
        tag: `div.${SIGNATURE_CLASS}, div.${CORE_SIGNATURE_CLASS}`,
        getAttrs: (el) => {
          const element = el as HTMLElement;
          const id = Number(element.getAttribute("data-signature-id"));
          return { signatureId: Number.isFinite(id) && id > 0 ? id : null, html: sanitizeSignatureHtml(element.innerHTML) };
        },
      },
    ];
  },

  renderHTML({ node }) {
    const el = document.createElement("div");
    el.className = CORE_SIGNATURE_CLASS;
    if (node.attrs.signatureId) el.setAttribute("data-signature-id", String(node.attrs.signatureId));
    el.innerHTML = node.attrs.html as string;
    return el;
  },

  addNodeView() {
    return ({ node, editor, getPos }) => {
      let current = node;
      const dom = document.createElement("div");
      dom.className = SIGNATURE_CLASS;
      dom.contentEditable = "false";
      const inner = document.createElement("div");
      inner.className = "flint-sig-body";
      inner.contentEditable = "true";
      inner.setAttribute("aria-label", "Signature");
      inner.innerHTML = current.attrs.html as string;
      dom.append(inner);

      inner.addEventListener("input", () => {
        const pos = getPos();
        if (typeof pos !== "number") return;
        const tr = editor.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, html: inner.innerHTML });
        editor.view.dispatch(tr);
      });

      return {
        dom,
        stopEvent: () => true,
        ignoreMutation: () => true,
        update: (updated) => {
          if (updated.type !== current.type) return false;
          current = updated;
          if (inner.innerHTML !== updated.attrs.html && !inner.contains(document.activeElement)) inner.innerHTML = updated.attrs.html as string;
          return true;
        },
      };
    };
  },
});
