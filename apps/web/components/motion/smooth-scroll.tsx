'use client';

import { useEffect } from 'react';
import Lenis from 'lenis';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

/**
 * Smooth scrolling, and the one place GSAP is wired to it.
 *
 * Two things have to be true for scroll-driven animation to behave. ScrollTrigger must
 * recompute on Lenis's virtual scroll rather than the browser's native scroll event, or
 * every pinned section drifts out of step with the page. And Lenis must be driven from
 * GSAP's ticker rather than its own `requestAnimationFrame`, or the two run on separate
 * frame loops and the result judders under load. Both are done here, once.
 *
 * **Reduced motion is honoured by not running at all.** A visitor who has asked for
 * reduced motion gets native scrolling and no ScrollTrigger animation, because a
 * "gentler" smooth scroll is still smooth scroll — it is the hijacking they asked to
 * avoid, not the easing curve. The CSS media query cannot do this part: it can shorten a
 * transition, but it cannot stop a library from taking over the scrollbar.
 */
export function SmoothScroll() {
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (reduced.matches) return;

    gsap.registerPlugin(ScrollTrigger);

    const lenis = new Lenis({
      duration: 1.05,
      // Slightly under-damped: enough glide to feel considered, not enough to feel slow
      // when someone is trying to get to the bottom of the page.
      easing: (t: number) => Math.min(1, 1.001 - 2 ** (-10 * t)),
      smoothWheel: true,
      // Touch devices already have momentum scrolling of their own, and layering ours on
      // top of it fights the platform.
      syncTouch: false,
    });

    // Wrapped rather than passed as a bare method reference: detaching `update` from
    // ScrollTrigger and calling it later would invoke it with the wrong `this`.
    const onLenisScroll = (): void => {
      ScrollTrigger.update();
    };

    lenis.on('scroll', onLenisScroll);

    const tick = (time: number) => {
      // GSAP's ticker is in seconds, Lenis expects milliseconds.
      lenis.raf(time * 1000);
    };

    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);

    return () => {
      gsap.ticker.remove(tick);
      lenis.off('scroll', onLenisScroll);
      lenis.destroy();
      // Kill only the triggers, not the tweens: a tween may belong to a component that
      // is still mounted, and killing it would leave that element mid-animation.
      for (const trigger of ScrollTrigger.getAll()) trigger.kill();
    };
  }, []);

  return null;
}
