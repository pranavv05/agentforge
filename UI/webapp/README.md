# AgentForge — Agentic SDD Platform

Evidence-checked spec-driven development. UI modelled on the jimo.ai/product/ai marketing site, built from the *Agentic SDD Platform: Build Plan, Retrieval Strategy, Orchestration and Differentiator (Nov 2026)* document.

## Features (completed)
- **Landing page** (`/`): sticky nav with mega-menus, auto-rotating "three guarantees" tabs, pipeline diagram, live grounding-verifier widget, bento grid, cost slider, comparison table, FAQ.
- **Auth** (`/login`, `/signup`): PBKDF2 hashing, HttpOnly SameSite=Lax session cookies, proxy-safe same-origin check (Sec-Fetch-Site, then Origin vs Host / X-Forwarded-Host), one-click demo workspace, plain-language error messages.
- **Dashboard** (`/app`): overview (KPIs, getting-started checklist, needs-attention, recent activity), specs list with search and status filters, new spec, spec detail (stepper, approvals, version diff, audit, cost ledger, tasks), Grounding lab, Compliance pack. Sidebar links out to the docs.
- **Docs** (`/docs`, `/docs/:slug`): 8 pages sourced from `src/content/docs/*.md`: Introduction, Quickstart, Core concepts, Grounding and compliance, API reference, Errors and troubleshooting, FAQ, Changelog. Search (press `/`), copy buttons on code blocks, on-page table of contents, prev/next.

## Live simulation removed (Nov 2026)
The "Live run" / Mission Control section was removed from the landing page (`frontend/app/components/mission/`, its CSS, and the `#agents` anchors). Hero and bottom CTAs now point to `/signup`. The old Hono-rendered landing (`src/pages/landing.ts` and its vanilla JS) was deleted; `/` is served only from the Next.js export.

## Bring your own key, simplified (Nov 2026)
AgentForge is open source, so users connect their own Claude API key. The key section is now one small card (paste key, see it recognised, Continue) plus three steps: create a key, paste it, start building. The cost planner, per-stage model pickers, spend slider, workspace.env code block and pricing wording were removed from the landing page (`frontend/app/components/KeyVault.tsx`), `/product/byok`, `/docs/byok` and the FAQ. The key check runs in the browser only; nothing is sent or stored from these pages.

## Frontend architecture
- **Landing (`/`)**: Next.js 16 + React 19 in `frontend/` (static export), built by `npm run build:frontend`, copied into the worker by `frontend/scripts/export-to-worker.mjs`.
- **Still Hono-rendered HTML + vanilla JS**: `/login`, `/signup`, `/app` (dashboard), `/docs/*`, `/product/*`, `/resources/*`, `/compare/*`.

## Interactivity pass (Nov 2026)
- **Floating note fixed**: the Orchestrator / Verifier / Compliance-lint note in the Governed / Grounded / Compliant demo is now part of the normal layout (below the table) instead of an absolutely-positioned overlay, so it can no longer hide content, at any width.
- **Every tile is functional**: hero chips, hero KPIs and sidebar, pipeline nodes, number tiles, bento cards, stat cards and the logo marquee are real links to the matching docs section or page section. The demo window sidebar switches its panel.
- **Dashboard tiles are clickable** (KPIs, stepper steps, activity rows, stage-mix rows) with keyboard support.
- **Bugs fixed**: tasks could not be marked complete (status mismatch `done` vs `completed`); mobile dashboard sidebar was stuck open (animation overrode the off-canvas transform); grounding sample 1 pointed at the wrong line range; mobile nav now closes after a link tap; anchors no longer hide under the sticky nav; new docs section "Hindi and Hinglish input".

## Entry points
`/` `/login` `/signup` `/app` (hash routes: `#/`, `#/specs`, `#/new`, `#/spec/:id/:tab`, `#/lab`, `#/compliance`) `/docs` `/docs/:slug` and the `/api/*` routes listed in `/docs/api`.

## What is real vs simulated
Real: state machine with optimistic locking, hash-bound approvals, append-only audit log (DB triggers), downstream hash checks, grounding verifier, compliance lint, cost cap and `llm_calls` ledger, PreToolUse hook decision, auth.
Simulated: model output (deterministic generators), token counts (priced with the plan's real table), repo (embedded `acme-erp` sample, regex instead of tree-sitter), MCP server (API endpoints).

## Data model (Cloudflare D1)
`users, sessions, specs, artifacts (versioned + sha256), approvals, audit_log (append-only), llm_calls, tasks` (`plan_progress` is unused now that the internal 20-day plan page was removed) — see `migrations/0001_init.sql`.

## Alignment with the `agentforge` repo (Nov 2026)
The web UI now follows the frozen `@agentforge/contract` package from the uploaded repo:
- **States**: `CHANGES_REQUESTED` removed. Reject and request-changes are a human edge straight back to `REQ_DRAFTING` / `DESIGN_DRAFTING`. Added `FAILED` (terminal, reachable from any non-terminal state), `CONTEXT_READY -> CONTEXT_SCANNING` (re-scan) and `IMPLEMENTING -> READY_FOR_IMPLEMENTATION` (pause). Terminal states have no outgoing edges.
- **Decisions**: `approve | reject | request_changes`, body `{ expected_version, content_hash, comment }` (old `version/hash/changes` still accepted as aliases).
- **Spec shape**: `mode: greenfield | brownfield` (was Case A/B), task statuses `pending | in_progress | completed | blocked`.
- **Errors**: contract envelope `{ error: { code, message, details, correlation_id } }` with `VALIDATION_FAILED, ILLEGAL_TRANSITION, VERSION_CONFLICT, HASH_MISMATCH, PRECONDITION_FAILED, BUDGET_EXCEEDED, NOT_FOUND, INTERNAL`.
- **Not ported** (still simulated here): Anthropic calls, SQLite/Drizzle persistence, MCP server, Claude Code plugin, SSE stream route, `/artifacts/:kind` route aliases.

## Motion
- Landing (`public/static/scroll.js`, one rAF loop, no dependencies): scroll progress bar, hero window that flattens on scroll, parallax orbs and chips, masked word-by-word headings, word-highlight manifesto, velocity-reactive marquees, pinned scroll-scrubbed pipeline (desktop only), count-up numbers, staggered bento with spotlight and 3D tilt, scroll-tilted product window, growing CTA, cursor glow, magnetic buttons.
- Login: staggered form entrance, exit transition, dark welcome splash.
- Dashboard: sidebar slide-in, staggered cards and rows, KPI count-up, bar fills.
- `prefers-reduced-motion` disables all of it; mobile (<900px) disables pinning and parallax.

## Local development
```bash
npm run build
npm run db:reset            # applies migrations to local D1
pm2 start ecosystem.config.cjs
curl http://localhost:3000
```

## Not yet implemented
Real Anthropic calls, real repo ingestion (tree-sitter + FTS5), MCP server / Claude Code plugin packaging, password reset, production Cloudflare deployment (the `database_id` in `wrangler.jsonc` is a placeholder).

## Deployment
Not deployed yet. Local preview only. Tech stack: Hono + TypeScript + Cloudflare D1, vanilla JS front end.
