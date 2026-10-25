import { useRef, useState } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { Bold, Code2, ImagePlus, Italic, Link2, Underline as UnderlineIcon } from "lucide-react";
import { Button, IconButton, Input, TextArea } from "../../../ui";
import styles from "../settings.module.css";
import { needsSourceMode, normalizeLink, readImageFile, sanitizeHtml } from "./richText";

type Props = {
  /** Initial HTML. Remount (change `key`) to load a different document. */
  initial: string;
  onChange: (html: string) => void;
  label: string;
  images?: boolean;
  placeholder?: string;
};

/**
 * Rich text with links, images (stored as data URLs) and an HTML source view.
 * The visual view cannot represent every kind of markup, so source edits are kept verbatim until the user goes back to visual.
 */
export function RichEditor({ initial, onChange, label, images = true }: Props) {
  const [source, setSource] = useState(() => needsSourceMode(initial));
  const [html, setHtml] = useState(initial);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkValue, setLinkValue] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<Editor | null>(null);

  const emit = (next: string) => {
    setHtml(next);
    onChange(next);
  };

  const insertImage = async (file: File) => {
    const r = await readImageFile(file);
    if (!r.ok) return setNotice(r.message);
    setNotice(null);
    editorRef.current?.chain().focus().setImage({ src: r.dataUrl }).run();
  };

  const editor = useEditor({
    extensions: [StarterKit.configure({ link: { openOnClick: false, autolink: true } }), Image.configure({ allowBase64: true, inline: true })],
    content: initial,
    shouldRerenderOnTransaction: true,
    onUpdate: ({ editor: e }) => emit(e.getHTML()),
    editorProps: {
      attributes: { "aria-label": label, role: "textbox", "aria-multiline": "true" },
      handlePaste: (_view, event) => {
        const file = Array.from(event.clipboardData?.files ?? []).find((f) => f.type.startsWith("image/"));
        if (!file || !images) return false;
        void insertImage(file);
        return true;
      },
    },
  });
  editorRef.current = editor;

  const toggleSource = () => {
    if (source) {
      const clean = sanitizeHtml(html);
      editor?.commands.setContent(clean, { emitUpdate: false });
      setHtml(clean);
      setSource(false);
    } else {
      setSource(true);
    }
  };

  const applyLink = () => {
    const href = normalizeLink(linkValue);
    if (!href) return setNotice("Enter a web address, an email address or a mailto link.");
    setNotice(null);
    editor?.chain().focus().extendMarkRange("link").setLink({ href }).run();
    setLinkOpen(false);
  };

  const openLink = () => {
    setLinkValue((editor?.getAttributes("link").href as string | undefined) ?? "");
    setLinkOpen(true);
  };

  return (
    <div className={styles.editor}>
      <div className={styles.editorBar} role="toolbar" aria-label={`${label} formatting`}>
        <IconButton label="Bold" size={28} pressed={editor?.isActive("bold")} disabled={source} onClick={() => editor?.chain().focus().toggleBold().run()}><Bold size={16} strokeWidth={1.5} /></IconButton>
        <IconButton label="Italic" size={28} pressed={editor?.isActive("italic")} disabled={source} onClick={() => editor?.chain().focus().toggleItalic().run()}><Italic size={16} strokeWidth={1.5} /></IconButton>
        <IconButton label="Underline" size={28} pressed={editor?.isActive("underline")} disabled={source} onClick={() => editor?.chain().focus().toggleUnderline().run()}><UnderlineIcon size={16} strokeWidth={1.5} /></IconButton>
        <IconButton label="Link" size={28} pressed={editor?.isActive("link")} disabled={source} onClick={openLink}><Link2 size={16} strokeWidth={1.5} /></IconButton>
        {images ? (
          <IconButton label="Insert image" size={28} disabled={source} onClick={() => fileRef.current?.click()}><ImagePlus size={16} strokeWidth={1.5} /></IconButton>
        ) : null}
        <span style={{ flex: 1 }} />
        <IconButton label={source ? "Back to visual editor" : "Edit HTML source"} size={28} pressed={source} onClick={toggleSource}><Code2 size={16} strokeWidth={1.5} /></IconButton>
        <input ref={fileRef} type="file" accept="image/*" hidden aria-label="Choose an image" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void insertImage(f); }} />
      </div>
      {linkOpen && !source ? (
        <div className={styles.editorBar}>
          <Input aria-label="Link address" autoFocus value={linkValue} placeholder="https://example.com" onChange={(e) => setLinkValue(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); applyLink(); } }} />
          <Button variant="primary" size="sm" onClick={applyLink}>Apply</Button>
          <Button variant="ghost" size="sm" onClick={() => { editor?.chain().focus().unsetLink().run(); setLinkOpen(false); }}>Remove link</Button>
        </div>
      ) : null}
      {source ? (
        <div style={{ padding: "var(--s-3)" }}>
          <TextArea className={styles.source} aria-label={`${label} HTML source`} value={html} spellCheck={false} onChange={(e) => emit(e.target.value)} />
          <p className={styles.muted} style={{ marginTop: 6 }}>Paste a signature from another app here. Going back to the visual editor removes markup it can't show, such as tables.</p>
        </div>
      ) : (
        <div className={styles.editorBody}><EditorContent editor={editor} /></div>
      )}
      {notice ? <p role="alert" className={styles.err} style={{ padding: "0 var(--s-3) var(--s-2)" }}>{notice}</p> : null}
    </div>
  );
}
