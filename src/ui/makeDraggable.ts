import { hostScale } from "./hud/uiScale";

/** Enables dragging `element` by pointer events on `handle`. */
export function makeDraggable(
  element: HTMLElement,
  handle: HTMLElement,
  onDragGesture?: () => void,
): void {
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let originLeft = 0;
  let originTop = 0;
  let scale = 1;

  const onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest("button")) return;

    scale = hostScale(element);
    const host = element.offsetParent as HTMLElement | null;
    const hostRect = host?.getBoundingClientRect();
    const rect = element.getBoundingClientRect();

    // Pointer coords are post-scale; style.left is pre-scale. Convert once.
    const localLeft = (rect.left - (hostRect?.left ?? 0)) / scale;
    const localTop = (rect.top - (hostRect?.top ?? 0)) / scale;

    // Convert centered/transformed placement into absolute left/top matching
    // the *visual* box. Must clear transform — otherwise translate(-50%,-50%)
    // applies again on top of the new left/top and the window jumps.
    element.style.left = `${localLeft}px`;
    element.style.top = `${localTop}px`;
    element.style.right = "auto";
    element.style.bottom = "auto";
    element.style.transform = "none";

    dragging = true;
    startX = event.clientX;
    startY = event.clientY;
    originLeft = localLeft;
    originTop = localTop;
    element.classList.add("is-dragging");
    onDragGesture?.();
    handle.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (!dragging) return;

    const host = element.offsetParent as HTMLElement | null;
    const boundsW = host?.offsetWidth ?? window.innerWidth;
    const boundsH = host?.offsetHeight ?? window.innerHeight;

    const maxX = Math.max(0, boundsW - element.offsetWidth);
    const maxY = Math.max(0, boundsH - element.offsetHeight);
    const nextLeft = clamp(
      originLeft + (event.clientX - startX) / scale,
      0,
      maxX,
    );
    const nextTop = clamp(
      originTop + (event.clientY - startY) / scale,
      0,
      maxY,
    );

    element.style.left = `${nextLeft}px`;
    element.style.top = `${nextTop}px`;
  };

  const onPointerUp = (event: PointerEvent): void => {
    if (!dragging) return;
    dragging = false;
    element.classList.remove("is-dragging");
    onDragGesture?.();
    if (handle.hasPointerCapture(event.pointerId)) {
      handle.releasePointerCapture(event.pointerId);
    }
  };

  handle.addEventListener("pointerdown", onPointerDown);
  handle.addEventListener("pointermove", onPointerMove);
  handle.addEventListener("pointerup", onPointerUp);
  handle.addEventListener("pointercancel", onPointerUp);
}

/** Clears inline drag placement so CSS default positioning applies again. */
export function clearDragPosition(element: HTMLElement): void {
  element.style.left = "";
  element.style.top = "";
  element.style.right = "";
  element.style.bottom = "";
  element.style.transform = "";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
