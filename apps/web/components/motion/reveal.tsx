'use client';

import { useEffect, useRef, type ElementType, type ReactNode } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

/**
 * Scroll-triggered entrance.
 *
 * The rule this component exists to enforce: **the final state is the default state.**
 * The element is laid out and painted in its resting position, and the animation moves
 * it *from* an offset rather than *to* one. So if JavaScript never runs, if GSAP fails
 * to load, or if the visitor has asked for reduced motion, the page is simply the
 * finished page. Animating towards a final state would mean any of those cases leaves
 * content invisible — the most common way a heavily animated site becomes unusable.
 *
 * This is also why there is no `opacity: 0` in the stylesheet for these elements.
 */

export interface RevealProps {
  readonly children: ReactNode;
  /** Element to render. Defaults to a div, so headings can stay headings. */
  readonly as?: ElementType;
  readonly className?: string;
  /** Seconds to wait once the trigger fires, for staggering siblings deliberately. */
  readonly delay?: number;
  /** Travel distance in pixels. 0 fades without movement. */
  readonly y?: number;
  /** Animate direct children in sequence instead of the element as a whole. */
  readonly stagger?: number;
}

export function Reveal({
  children,
  as: Tag = 'div',
  className,
  delay = 0,
  y = 28,
  stagger,
}: RevealProps) {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    gsap.registerPlugin(ScrollTrigger);

    const targets =
      stagger === undefined ? element : (Array.from(element.children) as HTMLElement[]);
    if (Array.isArray(targets) && targets.length === 0) return;

    const tween = gsap.from(targets, {
      opacity: 0,
      y,
      duration: 0.85,
      ease: 'power3.out',
      delay,
      ...(stagger === undefined ? {} : { stagger }),
      scrollTrigger: {
        trigger: element,
        // Fires when the element is comfortably in view rather than at the very edge,
        // so the movement is seen rather than already finished by the time it arrives.
        start: 'top 85%',
        once: true,
      },
    });

    return () => {
      // `revert()` not `kill()`: revert restores the inline styles GSAP set, leaving the
      // element exactly as the stylesheet describes it.
      tween.scrollTrigger?.kill();
      tween.revert();
    };
  }, [delay, y, stagger]);

  return (
    <Tag ref={ref} className={className}>
      {children}
    </Tag>
  );
}
