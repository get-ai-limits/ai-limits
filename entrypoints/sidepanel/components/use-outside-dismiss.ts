import { useEffect, useRef, type RefObject } from "react";

/**
 * While `active`, a pointer press anywhere outside `ref` calls `onDismiss`.
 * A chart pins its readout on click; a click elsewhere on the page clears it.
 */
export function useOutsideDismiss(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  onDismiss: () => void,
): void {
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;

  useEffect(() => {
    if (!active) return undefined;
    const handle = (event: PointerEvent): void => {
      const element = ref.current;
      if (element && event.target instanceof Node && element.contains(event.target)) return;
      dismiss.current();
    };
    document.addEventListener("pointerdown", handle, true);
    return () => document.removeEventListener("pointerdown", handle, true);
  }, [active, ref]);
}
