import {
  ApiErrorSchema,
  StreamEventSchema,
  isAgentForgeError,
  isAwaitingHuman,
  isTerminalState,
  type StreamEvent,
} from '@agentforge/contract';
import { getDb } from '@agentforge/db';
import { getCostSummary, requireSpecById } from '@agentforge/orchestrator';
import { requestActor } from '@/lib/actor';

/**
 * `GET /api/specs/:id/stream` — server-sent events for one spec.
 *
 * The UI uses this to follow a run without polling from the browser: state changes and
 * spend as they land, then a terminal `done`.
 *
 * It is backed by the database rather than an in-process event bus, deliberately. An
 * agent run may be driven by a different process — a route handler, the CLI, the eval
 * harness — and the database is the one thing all of them write to. Polling a single
 * indexed row every 500ms is cheap, works across processes, and survives a restart
 * mid-run, which an in-memory emitter would not.
 *
 * Streaming is a UX affordance and costs nothing extra; batching is the only real cost
 * lever, and it is used where humans are not waiting.
 */

/** How often to re-read the spec row. */
const POLL_MS = 500;

/** Hard stop, so an abandoned tab cannot hold a connection open indefinitely. */
const MAX_DURATION_MS = 10 * 60 * 1000;

/** Keep-alive comment interval, to survive proxies that time out idle connections. */
const HEARTBEAT_MS = 15_000;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  // Authenticated and validated *before* the stream opens, not inside it.
  //
  // This route used to start streaming unconditionally: with no session at all it
  // returned 200 and served any spec's live state and spend, while every other route
  // refused the same request with 401. It was also a resource problem, not just a
  // disclosure one — an unauthenticated caller could hold a connection open for ten
  // minutes, each polling the database twice a second.
  //
  // It cannot use `handle()`, which returns JSON, so it asks the same question
  // (`requestActor`) and refuses in the same shape. The status has to be a real HTTP
  // status rather than an `error` event inside a 200: an EventSource cannot read a body,
  // so a refusal it cannot see as a status is a refusal it cannot act on.
  try {
    await requestActor(request);
    requireSpecById(getDb(), (await params).id);
  } catch (error) {
    if (isAgentForgeError(error)) {
      return Response.json(ApiErrorSchema.parse(error.toApiError()), { status: error.status });
    }
    throw error;
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const { id } = await params;
      const db = getDb();

      const send = (event: StreamEvent): void => {
        // Validated on the way out: the UI parses these with the same schema, so an
        // event that would fail there should fail here, where it is debuggable.
        const payload = StreamEventSchema.parse(event);
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };

      const comment = (text: string): void => {
        controller.enqueue(encoder.encode(`: ${text}\n\n`));
      };

      // Read through a function, not a variable: the flag is set from the abort
      // handler, which the type checker's control-flow analysis cannot see. Checking a
      // plain boolean would be narrowed to a constant by the loop condition and the
      // mid-loop guard would be reported as dead.
      let aborted = false;
      const isClosed = (): boolean => aborted;
      const close = (): void => {
        if (aborted) return;
        aborted = true;
        try {
          controller.close();
        } catch {
          // Already closed by the client disconnecting; nothing to do.
        }
      };

      // A client that navigates away aborts the request; stop work rather than polling
      // a row nobody is listening to.
      request.signal.addEventListener('abort', close);

      try {
        const initial = requireSpecById(db, id);
        send({ type: 'state', state: initial.status });

        let lastState = initial.status;
        let lastCost = getCostSummary(db, id).total_cost_usd;
        send({ type: 'cost', cost_usd: lastCost });

        const startedAt = Date.now();
        let lastHeartbeat = startedAt;

        while (!isClosed()) {
          await new Promise((resolve) => setTimeout(resolve, POLL_MS));
          if (isClosed()) break;

          const spec = requireSpecById(db, id);

          if (spec.status !== lastState) {
            lastState = spec.status;
            send({ type: 'state', state: spec.status });
          }

          const cost = getCostSummary(db, id).total_cost_usd;
          if (cost !== lastCost) {
            lastCost = cost;
            send({ type: 'cost', cost_usd: cost });
          }

          // A spec waiting on a human, or finished, has nothing more to stream: the
          // next change needs a human action, which the UI will trigger itself.
          if (isAwaitingHuman(spec.status) || isTerminalState(spec.status)) {
            send({ type: 'done', artifact_id: null });
            break;
          }

          if (Date.now() - startedAt > MAX_DURATION_MS) {
            send({ type: 'done', artifact_id: null });
            break;
          }

          if (Date.now() - lastHeartbeat > HEARTBEAT_MS) {
            lastHeartbeat = Date.now();
            comment('keep-alive');
          }
        }
      } catch (error) {
        // The client gets a typed terminal event rather than a dropped connection it
        // would have to interpret.
        send({
          type: 'error',
          code: 'STREAM_FAILED',
          message: error instanceof Error ? error.message : 'the stream failed',
        });
      } finally {
        close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      // Tells nginx and similar not to buffer, which would defeat the point.
      'x-accel-buffering': 'no',
    },
  });
}
