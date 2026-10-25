import { GalleryPanel } from "./GalleryPanel";
import styles from "./Gallery.module.css";

/** Every primitive in both themes, side by side. Open the web preview with ?gallery. */
export function Gallery() {
  return (
    <div className={styles.page}>
      <GalleryPanel theme="dark" title="Graphite" />
      <GalleryPanel theme="light" title="Paper" />
    </div>
  );
}
