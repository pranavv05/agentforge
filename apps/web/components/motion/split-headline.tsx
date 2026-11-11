'use client';

import { useEffect, useRef, type ElementType } from 'react';
import { gsap } from 'gsap';
import { SplitText } from 'gsap/SplitText';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

/**
 * A headline whose lines rise into place.
 *
 * The effect every reference site in the brief uses, and the one most likely to be done
 * badly. Three things make the difference:
 *
 * - **The text is real text.** SplitText wraps lines in spans at runtime; the markup
 *   this component renders is a plain heading with a plain string. Screen readers,
 *   search engines and a visitor with JavaScript off all get the sentence, and
 *   `revert()` puts the DOM back exactly as it was.
 * - **It animates *from* hidden, never *to* visible.** The resting state is the final
 *   state, so a failure to animate leaves a legible headline rather than a blank space.
 * - **It waits for fonts.** Splitting before the webfont loads measures lines at the
 *   fallback's metrics, so the lines re-wrap underneath the masks and the animation
 *   plays against the wrong geometry. `document.fonts.ready` is the fix and it is the
 *   step usually missing.
 */

export interface SplitHeadlineProps {
  readonly children: string;
  readonly as?: ElementType;
  readonly className?: string;
  readonly delay?: number;
  /** Animate on scroll instead of on mount. For headlines below the fold. */
  readonly onScroll?: boolean;
}

export function SplitHeadline({
  children,
  as: Tag = 'h2',
  className,
  delay = 0,
  onScroll = false,
}: SplitHeadlineProps) {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    gsap.registerPlugin(SplitText, ScrollTrigger);

    let split: SplitText | null = null;
    let tween: gsap.core.Tween | null = null;
    let cancelled = false;

    void document.fonts.ready.then(() => {
      if (cancelled || ref.current === null) return;

      split = new SplitText(element, {
        type: 'lines',
        // Each line gets a clipping parent, so a line rises out of its own mask rather
        // than sliding over the line above it.
        mask: 'lines',
        linesClass: 'split-line',
      });

      tween = gsap.from(split.lines, {
        yPercent: 110,
        duration: 1.05,
        ease: 'power4.out',
        stagger: 0.09,
        delay,
        ...(onScroll ? { scrollTrigger: { trigger: element, start: 'top 85%', once: true } } : {}),
      });
    });

    return () => {
      cancelled = true;
      tween?.scrollTrigger?.kill();
      tween?.revert();
      // Unwraps the line spans and restores the original markup.
      split?.revert();
    };
  }, [children, delay, onScroll]);

  return (
    <Tag ref={ref} className={className}>
      {children}
    </Tag>
  );
}
