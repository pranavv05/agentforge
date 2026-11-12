'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * A container that becomes keyboard-focusable only when it genuinely scrolls.
 *
 * A wide table in a narrow pane scrolls sideways, and a region that scrolls has to be
 * reachable by keyboard or its overflowing columns cannot be read without a mouse. But
 * making *every* table focusable is its own failure: a traceability-heavy document has
 * ten of them, and a keyboard user would Tab through ten identical stops to get past
 * content that fits on screen and needed none.
 *
 * So focusability follows overflow, measured, and re-measured when the pane resizes —
 * which it does, because the document pane changes width at the breakpoint.
 *
 * The region is named after the heading above it ("Traceability index table") because a
 * stop announced only as "table" tells you nothing about which one you are on.
 */
export function ScrollRegion({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (element === null) return undefined;

    const measure = (): void => {
      // The +1 absorbs sub-pixel rounding, which otherwise reports overflow on a table
      // that fits exactly.
      setOverflows(element.scrollWidth > element.clientWidth + 1);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, []);

  return (
    <div
      ref={ref}
      className={className}
      {...(overflows ? { role: 'region', 'aria-label': label, tabIndex: 0 } : {})}
    >
      {children}
    </div>
  );
}
