'use client';
import { useEffect } from 'react';
import { initMotion } from './motion';

/** Mounts the scroll-motion engine once the static markup is on the page. Renders nothing. */
export function MotionInit() {
  useEffect(() => {
    // wait a frame so every client component has committed its markup first
    let stop: (() => void) | undefined;
    const id = requestAnimationFrame(() => {
      stop = initMotion();
    });
    return () => {
      cancelAnimationFrame(id);
      stop?.();
    };
  }, []);
  return null;
}
