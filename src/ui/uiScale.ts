/**
 * The HUD lives inside a scaled layer (see #ui-root), so pointer coordinates —
 * which are always in screen pixels — have to be divided by the scale before
 * they can be written to `style.left` / `style.top` of anything inside it.
 */
export function hostScale(element: HTMLElement): number {
  const host = element.offsetParent as HTMLElement | null;
  if (!host?.offsetWidth) return 1;
  const factor = host.getBoundingClientRect().width / host.offsetWidth;
  return Number.isFinite(factor) && factor > 0 ? factor : 1;
}

/** Screen-space point to coordinates usable inside the scaled HUD layer. */
export function toHostSpace(
  element: HTMLElement,
  clientX: number,
  clientY: number,
): { x: number; y: number; scale: number } {
  const scale = hostScale(element);
  const host = element.offsetParent as HTMLElement | null;
  const rect = host?.getBoundingClientRect();
  return {
    x: (clientX - (rect?.left ?? 0)) / scale,
    y: (clientY - (rect?.top ?? 0)) / scale,
    scale,
  };
}
