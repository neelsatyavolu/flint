import { useEffect, useImperativeHandle, useRef, useState, type JSX, type Ref } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import type { Signature } from "@flint/core";
import { swapSignatureHtml } from "../signature";
import { aiTextToHtml } from "./aiHtml";
import { createExtensions } from "./extensions";
import { sanitizePastedHtml } from "./sanitize";
import { FormatBar } from "./FormatBar";
import "./editor.css";

export type BodySnapshot = { text: string; from: number; to: number; scope: "selection" | "body" };

export type BodyEditorHandle = {
  focus(): void;
  /** Text of the body without the signature. */
  getText(): string;
  /** The selection if there is one, else the whole body (signature excluded). */
  snapshot(): BodySnapshot;
  /** Replaces the range captured by snapshot() with AI output. */
  replace(snap: BodySnapshot, text: string): void;
  /** Inserts AI output at the cursor. */
  insert(text: string): void;
  /** Inserts trusted HTML (templates) at the cursor. */
  insertHtml(html: string): void;
  setSignature(signature: Signature | null): void;
};

type Props = {
  initialHtml: string;
  placeholder?: string;
  onChange: (html: string) => void;
  /** Called with data URI images pasted or dropped into the body. */
  onFiles?: (files: File[]) => void;
  handleRef?: Ref<BodyEditorHandle>;
  autoFocus?: boolean;
  compact?: boolean;
  plainTextOnly?: boolean;
  label?: string;
};

const MAX_INLINE_IMAGE = 5 * 1024 * 1024;

function signaturePos(editor: Editor): number | null {
  let pos: number | null = null;
  editor.state.doc.forEach((node, offset) => {
    if (node.type.name === "signature" && pos === null) pos = offset;
  });
  return pos;
}

/**
 * The signature is an atom block; the cursor needs a paragraph above it to type into. A body that ends in the
 * signature also gets the empty paragraph after it that the editor would otherwise add a frame later, which made the
 * docked reply grow by a line right after it opened.
 */
export function withLeadingParagraph(html: string): string {
  const lead = html.trimStart().startsWith("<p") ? html : `<p></p>${html}`;
  return /<\/div>\s*$/.test(lead) ? `${lead}<p></p>` : lead;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Couldn't read the image."));
    reader.readAsDataURL(file);
  });
}

export function BodyEditor({ initialHtml, placeholder = "Enter text", onChange, onFiles, handleRef, autoFocus, compact, plainTextOnly, label = "Message body" }: Props): JSX.Element {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [extensions] = useState(() => createExtensions(placeholder));

  const insertImages = (editor: Editor | null, files: File[]) => {
    const images = files.filter((f) => f.type.startsWith("image/") && f.size <= MAX_INLINE_IMAGE);
    const rest = files.filter((f) => !images.includes(f));
    if (rest.length) onFiles?.(rest);
    for (const file of images) {
      void readAsDataUrl(file).then((src) => editor?.chain().focus().setImage({ src, alt: file.name }).run());
    }
  };

  const editorRef = useRef<Editor | null>(null);
  const editor = useEditor({
    extensions,
    content: withLeadingParagraph(initialHtml),
    autofocus: autoFocus ? "start" : false,
    onUpdate: ({ editor: e }) => onChangeRef.current(e.getHTML()),
    editorProps: {
      attributes: { class: "flint-body", role: "textbox", "aria-multiline": "true", "aria-label": label },
      transformPastedHTML: sanitizePastedHtml,
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []);
        if (files.length === 0) return false;
        insertImages(editorRef.current, files);
        return true;
      },
      handleDrop: (_view, event) => {
        const files = Array.from(event.dataTransfer?.files ?? []);
        if (files.length === 0) return false;
        event.preventDefault();
        insertImages(editorRef.current, files);
        return true;
      },
    },
  });
  editorRef.current = editor;

  useImperativeHandle(
    handleRef,
    (): BodyEditorHandle => ({
      focus: () => editorRef.current?.commands.focus(),
      getText: () => {
        const e = editorRef.current;
        if (!e) return "";
        const sig = signaturePos(e);
        return e.state.doc.textBetween(0, sig ?? e.state.doc.content.size, "\n\n", "\n").trim();
      },
      snapshot: () => {
        const e = editorRef.current;
        if (!e) return { text: "", from: 0, to: 0, scope: "body" };
        const { from, to, empty } = e.state.selection;
        if (!empty) return { text: e.state.doc.textBetween(from, to, "\n\n", "\n"), from, to, scope: "selection" };
        const end = signaturePos(e) ?? e.state.doc.content.size;
        return { text: e.state.doc.textBetween(0, end, "\n\n", "\n").trim(), from: 0, to: end, scope: "body" };
      },
      replace: (snap, text) => {
        editorRef.current?.chain().focus().insertContentAt({ from: snap.from, to: snap.to }, snap.scope === "selection" ? text.trim() : aiTextToHtml(text)).run();
      },
      insert: (text) => {
        editorRef.current?.chain().focus().insertContent(aiTextToHtml(text)).run();
      },
      insertHtml: (html) => {
        editorRef.current?.chain().focus().insertContent(html).run();
      },
      setSignature: (signature) => {
        const e = editorRef.current;
        if (!e) return;
        e.commands.setContent(withLeadingParagraph(swapSignatureHtml(e.getHTML(), signature)), { emitUpdate: true });
      },
    }),
    [],
  );

  useEffect(() => () => editorRef.current?.destroy(), []);

  return (
    <div className={compact ? "flint-editor flint-editor-compact" : "flint-editor"}>
      <EditorContent editor={editor} />
      {editor && !plainTextOnly ? <FormatBar editor={editor} /> : null}
    </div>
  );
}
