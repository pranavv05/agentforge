import {
  CreateSpecRequestSchema,
  CreateSpecResponseSchema,
  ListSpecsQuerySchema,
  ListSpecsResponseSchema,
} from '@agentforge/contract';
import { getDb } from '@agentforge/db';
import { createSpec, listSpecs } from '@agentforge/orchestrator';
import { handle, parseBody, parseQuery } from '@/lib/handler';
import { presentSpec } from '@/lib/present';

/** `GET /api/specs` — the spec list, with optional status and mode filters. */
export function GET(request: Request): Promise<Response> {
  return handle(request, () => {
    const query = parseQuery(request, ListSpecsQuerySchema, { limit: '25', offset: '0' });
    const { specs, total } = listSpecs(getDb(), query);

    return ListSpecsResponseSchema.parse({ specs: specs.map(presentSpec), total });
  });
}

/** `POST /api/specs` — create a spec. It starts in CREATED with an opening audit entry. */
export function POST(request: Request): Promise<Response> {
  return handle(
    request,
    async ({ correlationId, actor }) => {
      const body = await parseBody(request, CreateSpecRequestSchema);
      const spec = createSpec(getDb(), {
        ...body,
        actor,
        correlationId,
      });

      return CreateSpecResponseSchema.parse({ spec: presentSpec(spec) });
    },
    { successStatus: 201 },
  );
}
