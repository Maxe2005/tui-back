import { useLayoutEffect, useRef, useState } from 'react';
import { measureElement, type DOMElement } from 'ink';

// Extracted from logs-zone.tsx (story 5.5): measures a bordered/padded Ink `Box`'s own content
// area for real, post-render, via Ink's `measureElement` — a caller seeds a rough estimate for
// the very first paint (before Yoga has computed a layout to measure), and every commit after
// that self-corrects to the element's true row/column budget. Generic enough to be reused by
// any zone needing a live content-box size, not just Logs.
export function useElementSize(): readonly [{ current: DOMElement | null }, { width: number; height: number } | null] {
  const ref = useRef<DOMElement | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  useLayoutEffect(() => {
    if (!ref.current) {
      return;
    }
    const { width, height } = measureElement(ref.current);
    setSize((current) => (current !== null && current.width === width && current.height === height ? current : { width, height }));
  });
  return [ref, size] as const;
}
