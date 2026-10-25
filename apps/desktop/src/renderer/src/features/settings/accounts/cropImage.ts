export const PHOTO_SIZE = 256;
/** Largest file Flint will try to decode for a profile picture. */
export const MAX_SOURCE_BYTES = 25 * 1024 * 1024;

/** The centered square inside a width x height image, as a source rectangle. */
export function squareCrop(width: number, height: number): { sx: number; sy: number; side: number } {
  const side = Math.min(width, height);
  return { sx: Math.floor((width - side) / 2), sy: Math.floor((height - side) / 2), side };
}

/** Crops an image file to its centered square, scales it to 256px and returns a PNG data URL. */
export async function cropToSquare(file: Blob, size = PHOTO_SIZE): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file.");
  if (file.size > MAX_SOURCE_BYTES) throw new Error("That image is too large. Choose one under 25 MB.");
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("Flint couldn't read that image. Try a PNG or JPEG.");
  }
  try {
    const { sx, sy, side } = squareCrop(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Flint couldn't process that image.");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, size, size);
    return canvas.toDataURL("image/png");
  } finally {
    bitmap.close();
  }
}
