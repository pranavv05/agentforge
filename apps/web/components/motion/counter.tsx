'use client';

import { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

/**
 * A number that counts up when it scrolls into view.
 *
 * Renders the final value as text first, then animates from zero. So the figure is in
 * the HTML, correct and readable, before any script runs — which matters more here than
 * on a typical marketing page, because these are measured results and a visitor should
 * never be shown a number that is still on its way to being true.
 *
 * `tabular-nums` is applied by the caller's class; without it the digits change width
 * as they count and the surrounding layout jitters.
 */

export interface CounterProps {
  readonly value: number;
  /** Decimal places. Measured costs need four; test counts need none. */
  readonly decimals?: number;
  readonly prefix?: string;
  readonly suffix?: string;
  readonly className?: string;
}

function format(value: number, decimals: number): string {
  return decimals > 0 ? value.toFixed(decimals) : Math.round(value).toLocaleString('en-GB');
}

export function Counter({
  value,
  decimals = 0,
  prefix = '',
  suffix = '',
  className,
}: CounterProps) {
  const ref = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    gsap.registerPlugin(ScrollTrigger);

    const state = { n: 0 };
    const tween = gsap.to(state, {
      n: value,
      duration: 1.5,
      ease: 'power2.out',
      onUpdate: () => {
        element.textContent = `${prefix}${format(state.n, decimals)}${suffix}`;
      },
      // Guards against the tween being killed mid-count and leaving a partial figure on
      // screen: whatever happens, the resting text is the real value.
      onComplete: () => {
        element.textContent = `${prefix}${format(value, decimals)}${suffix}`;
      },
      scrollTrigger: { trigger: element, start: 'top 90%', once: true },
    });

    return () => {
      tween.scrollTrigger?.kill();
      tween.kill();
      element.textContent = `${prefix}${format(value, decimals)}${suffix}`;
    };
  }, [value, decimals, prefix, suffix]);

  return (
    <span ref={ref} className={className}>
      {`${prefix}${format(value, decimals)}${suffix}`}
    </span>
  );
}
