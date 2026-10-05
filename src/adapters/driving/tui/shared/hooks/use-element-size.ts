import { useLayoutEffect, useRef, useState } from 'react';
import { measureElement, type DOMElement } from 'ink';

// Measures a bordered/padded Ink `Box`'s content area for real, post-render, via Ink's
// `measureElement` — the caller seeds a rough estimate for the first paint (before Yoga has a
// layout to measure), and every commit after that self-corrects to the true row/column budget.
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
