import { useEffect } from "react";
import { ChevronLeft, ChevronRight, Download, ExternalLink } from "lucide-react";
import type { AttachmentInfo } from "@flint/core";
import { formatFileSize } from "../../lib/format";
import { Button, Dialog, IconButton } from "../../ui";
import styles from "./AttachmentTiles.module.css";

/** The app's attachment scheme; the CSP allows it for images. */
export const attachmentSrc = (id: number) => `flint-attachment://${id}`;

type Props = {
  images: AttachmentInfo[];
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
  onSave: (a: AttachmentInfo) => void;
  onOpen: (a: AttachmentInfo) => void;
};

/** A message's image attachments, one at a time. Left and right arrows step through them; Esc closes. */
export function ImagePreview({ images, index, onIndex, onClose, onSave, onOpen }: Props) {
  const image = images[index];
  const many = images.length > 1;
  const step = (by: number) => onIndex((index + by + images.length) % images.length);

  useEffect(() => {
    if (!many) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      e.stopPropagation();
      onIndex((index + (e.key === "ArrowRight" ? 1 : -1) + images.length) % images.length);
    };
    // Capture, so the list's j/k and arrow shortcuts never see these keys while the preview is up.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [many, index, images.length, onIndex]);

  if (!image) return null;
  return (
    <Dialog
      open
      onClose={onClose}
      title={image.filename}
      width={880}
      footer={
        <>
          <span className={`t-data ${styles.previewMeta}`}>
            {many ? `${index + 1} of ${images.length} · ` : ""}{formatFileSize(image.size)}
          </span>
          <Button size="sm" variant="ghost" icon={<ExternalLink size={14} strokeWidth={1.5} />} onClick={() => onOpen(image)}>Open</Button>
          <Button size="sm" variant="ghost" icon={<Download size={14} strokeWidth={1.5} />} onClick={() => onSave(image)}>Save</Button>
        </>
      }
    >
      <div className={styles.stage}>
        {many ? <IconButton label="Previous image" shortcut="ArrowLeft" className={styles.prev} onClick={() => step(-1)}><ChevronLeft size={18} strokeWidth={1.5} /></IconButton> : null}
        <img key={image.id} className={styles.full} src={attachmentSrc(image.id)} alt={image.filename} draggable={false} />
        {many ? <IconButton label="Next image" shortcut="ArrowRight" className={styles.next} onClick={() => step(1)}><ChevronRight size={18} strokeWidth={1.5} /></IconButton> : null}
      </div>
    </Dialog>
  );
}
