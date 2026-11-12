'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { announce } from '@/components/workspace/announcer';
import {
  EMPTY_RUN,
  applyEvent,
  parseStreamData,
  type RunView,
} from '@/components/workspace/run-progress';
import { labelFor } from '@/components/workspace/status';

/**
 * Follows a spec's run over server-sent events.
 *
 * Connects only while something is actually running (`enabled`), and closes when it
 * stops. An EventSource left open on every thread would be a connection per tab per spec
 * for no reason, and — because the server closes the stream when it has nothing more to
 * say, and an EventSource treats that as a dropped connection and reconnects — an open
 * one would loop, reconnecting every few seconds to be told "done" again.
 *
 * It asks the page to re-render when something it can see has changed, and says what
 * happened to assistive technology, because a thread that updates itself silently is a
 * thread that did not update for anyone who cannot see it.
 */

export type Connection = 'connecting' | 'live' | 'lost';

export function useRunStream(
  specId: string,
  enabled: boolean,
): { readonly view: RunView; readonly connection: Connection } {
  const router = useRouter();
  const [view, setView] = useState<RunView>(EMPTY_RUN);
  const [connection, setConnection] = useState<Connection>('connecting');

  useEffect(() => {
    if (!enabled) return undefined;

    setView(EMPTY_RUN);
    setConnection('connecting');

    // Same origin, so the session cookie goes with it. The route refuses a request with
    // none, which an EventSource sees only as a closed connection — handled below.
    const source = new EventSource(`/api/specs/${specId}/stream`);

    // The reducer is run against a local rather than against state, so two events
    // arriving in the same tick are folded in order instead of both reading the same
    // stale snapshot.
    let current = EMPTY_RUN;

    source.onopen = () => {
      setConnection('live');
    };

    source.onmessage = (message: MessageEvent<unknown>) => {
      const parsed = parseStreamData(String(message.data));

      if (!parsed.ok) {
        // Not skipped: an interface that quietly ignores part of its stream can show a
        // "live" indicator that is wrong with no way to say why.
        setConnection('lost');
        source.close();
        return;
      }

      const { next, refresh } = applyEvent(current, parsed.event, Date.now());
      current = next;
      setView(next);

      if (refresh) {
        if (parsed.event.type === 'state') announce(`${labelFor(parsed.event.state)}.`);
        router.refresh();
      }

      // Closed by us, so the browser does not "reconnect" to a stream that has finished.
      if (next.settled) source.close();
    };

    source.onerror = () => {
      // CONNECTING means the browser is retrying on its own — a blip, not a failure. CLOSED
      // means it has given up, which is what a 401 or a 404 looks like from here.
      setConnection(source.readyState === EventSource.CLOSED ? 'lost' : 'connecting');
    };

    return () => {
      source.close();
    };
  }, [specId, enabled, router]);

  return { view, connection };
}

/** The current time in ms, ticking each second while `active`, and still when not. */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return undefined;

    setNow(Date.now());
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => {
      clearInterval(timer);
    };
  }, [active]);

  return now;
}
