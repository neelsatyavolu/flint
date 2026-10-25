/** DESIGN.md --plane-1 for each theme; the window shows it before the renderer paints. */
export const PLANE_1_DARK = "#161615";
export const PLANE_1_LIGHT = "#F6F4EE";

export function planeBackground(dark: boolean): string {
  return dark ? PLANE_1_DARK : PLANE_1_LIGHT;
}
