import { useState } from "react";
import { Download, File, FileArchive, FileImage, FileSpreadsheet, FileText, type LucideIcon } from "lucide-react";
import type { AttachmentInfo } from "@flint/core";
import { flint } from "../../lib/api";
import { formatFileSize, pluralize } from "../../lib/format";
import { Button, IconButton, useToast } from "../../ui";
import { ImagePreview, attachmentSrc } from "./ImagePreview";
import styles from "./AttachmentTiles.module.css";

export type FileKind = "image" | "pdf" | "doc" | "sheet" | "zip" | "file";

const EXT: Record<string, FileKind> = {
  pdf: "pdf",
  doc: "doc", docx: "doc", rtf: "doc", odt: "doc", pages: "doc", txt: "doc", md: "doc",
  xls: "sheet", xlsx: "sheet", csv: "sheet", tsv: "sheet", ods: "sheet", numbers: "sheet",
  zip: "zip", gz: "zip", tgz: "zip", rar: "zip", "7z": "zip", tar: "zip", bz2: "zip",
};

/** What kind of file an attachment is, from its content type and then its extension. */
export function fileKind(a: Pick<AttachmentInfo, "contentType" | "filename">): FileKind {
  const type = a.contentType.toLowerCase();
  // SVG can carry script; it gets the generic image glyph but never a thumbnail (see `previewable`).
  if (type.startsWith("image/")) return "image";
  if (type === "application/pdf") return "pdf";
  if (/zip|compressed|x-tar|gzip|x-7z|x-rar/.test(type)) return "zip";
  if (/spreadsheet|ms-excel|text\/csv/.test(type)) return "sheet";
  if (/msword|wordprocessing|opendocument\.text|rtf|text\/plain/.test(type)) return "doc";
  const ext = a.filename.toLowerCase().split(".").pop() ?? "";
  return EXT[ext] ?? "file";
}

/** Raster images the reader can show inline (thumbnail and preview). */
export function previewable(a: Pick<AttachmentInfo, "contentType" | "filename">): boolean {
  return fileKind(a) === "image" && !/svg/i.test(a.contentType);
}

const ICONS: Record<FileKind, LucideIcon> = { image: FileImage, pdf: FileText, doc: FileText, sheet: FileSpreadsheet, zip: FileArchive, file: File };

export function AttachmentTiles({ attachments }: { attachments: AttachmentInfo[] }) {
  const toast = useToast();
  const [preview, setPreview] = useState<number | null>(null);
  const files = attachments.filter((a) => !a.inline);
  if (files.length === 0) return null;
  const images = files.filter(previewable);
  const open = (a: AttachmentInfo) => void flint.openAttachment(a.id).catch(() => toast.show({ message: `Couldn't open ${a.filename}.`, level: "error" }));
  const save = (a: AttachmentInfo) =>
    void flint.saveAttachment(a.id).then(
      () => toast.show({ message: `Saved ${a.filename} to Downloads` }),
      () => toast.show({ message: `Couldn't save ${a.filename}.`, level: "error" }),
    );
  const saveAll = async () => {
    const results = await Promise.allSettled(files.map((a) => flint.saveAttachment(a.id)));
    const failed = files.filter((_, i) => results[i]?.status === "rejected");
    if (failed.length === 0) toast.show({ message: `Saved ${pluralize(files.length, "file")} to Downloads` });
    else toast.show({ message: `Saved ${files.length - failed.length} of ${files.length} files. Couldn't save ${failed.map((a) => a.filename).join(", ")}.`, level: "error" });
  };
  return (
    <div className={styles.wrap}>
      <ul className={styles.tiles} aria-label="Attachments">
        {files.map((a) => {
          const Icon = ICONS[fileKind(a)];
          const image = previewable(a);
          return (
            <li key={a.id} className={styles.tile}>
              <button
                type="button"
                className={styles.tileMain}
                onClick={() => (image ? setPreview(images.indexOf(a)) : open(a))}
                title={a.filename}
                aria-label={image ? `Preview ${a.filename}` : `Open ${a.filename}`}
              >
                {image ? <img className={styles.thumb} src={attachmentSrc(a.id)} alt="" loading="lazy" draggable={false} /> : <Icon size={18} strokeWidth={1.5} color="var(--fg-2)" aria-hidden />}
                <span className={styles.tileText}>
                  <span className={styles.tileName}>{a.filename}</span>
                  <span className={`t-data ${styles.tileSize}`}>{formatFileSize(a.size)}</span>
                </span>
              </button>
              <IconButton label={`Save ${a.filename}`} size={24} onClick={() => save(a)}><Download size={14} strokeWidth={1.5} /></IconButton>
            </li>
          );
        })}
      </ul>
      {files.length > 1 ? (
        <Button size="sm" variant="ghost" className={styles.saveAll} onClick={() => void saveAll()}>
          Save all
        </Button>
      ) : null}
      {preview !== null && images[preview] ? (
        <ImagePreview images={images} index={preview} onIndex={setPreview} onClose={() => setPreview(null)} onSave={save} onOpen={open} />
      ) : null}
    </div>
  );
}
