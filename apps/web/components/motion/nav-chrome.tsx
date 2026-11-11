'use client';

import { useEffect } from 'react';

/**
 * Nav behaviour on scroll.
 *
 * Solves a specific problem rather than being an effect for its own sake. A translucent
 * sticky bar looks right over the paper ground and wrong over the inverted band — the
 * blur turns it into a washed grey stripe across the black. Tracking which section is
 * underneath would mean an observer per section and a nav that flickers at the seams.
 *
 * Hiding the bar when the reader is moving down the page and bringing it back the
 * moment they move up avoids the problem entirely, and is the behaviour people
 * actually want: the nav is there when you reach for it and out of the way when you
 * are reading.
 *
 * Classes are toggled on `<body>` so the CSS owns the appearance and this file owns only
 * the decision. No styles are set from JavaScript.
 */

/** Distance past the hero before the bar gets a background at all. */
const SOLID_AFTER = 80;

/** Ignore jitter below this, or a trackpad's noise flickers the bar. */
const THRESHOLD = 8;

export function NavChrome() {
  useEffect(() => {
    const body = document.body;
    let last = window.scrollY;
    let frame = 0;

    const update = () => {
      frame = 0;
      const y = window.scrollY;
      const delta = y - last;

      body.classList.toggle('is-scrolled', y > SOLID_AFTER);

      if (Math.abs(delta) > THRESHOLD) {
        // Never hide at the very top: the bar should be present when the page loads and
        // when the reader returns to the hero.
        body.classList.toggle('is-nav-hidden', delta > 0 && y > SOLID_AFTER * 3);
        last = y;
      }
    };

    const onScroll = () => {
      // Coalesced into a frame: scroll fires far more often than the screen repaints,
      // and toggling a class on every event is wasted work.
      frame ||= window.requestAnimationFrame(update);
    };

    update();
    window.addEventListener('scroll', onScroll, { passive: true });

    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame !== 0) window.cancelAnimationFrame(frame);
      body.classList.remove('is-scrolled', 'is-nav-hidden');
    };
  }, []);

  return null;
}
