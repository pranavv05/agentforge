# Agentic SDD Platform: Build Plan, Retrieval Strategy, Orchestration Choice and Differentiator (Nov 2026)

Build Case B retrieval with no embeddings: use the Claude Code-style agentic loop (ripgrep + glob + ranged file reads), seeded by a free tree-sitter "repo map" and per-module summaries. Run it on Claude Haiku 5.5 with prompt caching and a grounding verifier. Orchestrate with your own database-backed state machine, not a framework. Make "verifiable grounding + compliance traceability" the differentiator, not the spec pipeline itself, because Spec Kit, OpenSpec, BMAD, Kiro and Spec Workflow MCP already produce requirements/design/tasks documents.

## TL;DR

- **Retrieval (Case B):** Anthropic's Claude Code team dropped RAG with a local vector DB in favour of agentic search. Their published context-engineering guidance recommends a hybrid: CLAUDE.md files loaded up front, glob/grep just in time. Copy that. Add an Aider-style tree-sitter repo map and SQLite FTS5 (both free and local), and skip embeddings entirely. Estimated LLM cost is about $0.03–$0.45 per feature for the context step and about $0.65–$1.05 for the full brownfield spec pipeline.
- **Orchestration:** A hand-rolled Postgres/SQLite state machine behind Next.js API routes needs the least code and carries the least risk in 15–20 days. It also makes your governance rule ("agents propose, orchestrator transitions, humans approve") inspectable. LangGraph and Mastra both support suspend/resume. Claude Agent SDK and Claude Code hooks fit per-tool approvals and the implementation phase, not multi-day gate orchestration. Temporal/Inngest are overkill.
- **Differentiator:** Don't pitch "another SDD pipeline." Pitch **evidence-checked specs**: every claim in design.md about the existing codebase is machine-verified against real file:line references. On top of that, a **compliance pack** (GST e-invoice fields + TDS under the new Income-tax Act 2025, Section 393) injects testable acceptance criteria and traces them requirement → design → task → test. Play the Indian-SMB compliance angle narrowly. Treat vernacular as input-only and drop ABDM, because its sandbox requires organisation onboarding.

## Key Findings

| Question | Answer | Confidence |
|---|---|---|
| Does Anthropic recommend vector RAG for code? | No. Boris Cherny (Claude Code creator), Feb 1 2026: "Early versions of Claude Code used RAG + a local vector db, but we found pretty quickly that agentic search generally works better. It is also simpler and doesn't have the same issues around security, privacy, staleness, and reliability."\[1\] | High (primary post) |
| Was that backed by benchmarks? | Mostly not. On the Latent Space podcast ("Claude Code: Anthropic's Agent in Your Terminal", May 2025), asked "In what benchmark?", Cherny said: "This was just vibes, so internal vibes. There's some internal benchmarks also, but mostly vibes. It just felt better." Treat the claim as practitioner judgement backed by unpublished internal benchmarks, not a published eval. | High (primary podcast) |
| Anthropic's documented pattern | Hybrid: "CLAUDE.md files are naively dropped into context up front, while primitives like glob and grep allow it to navigate its environment and retrieve files just-in-time."\[2\] (Anthropic, *Effective context engineering for AI agents*)\[3\] | High |
| Cost of pure agentic search | Not free in tokens. One arXiv paper (SpIDER) measured OpenHands' agentic exploration at 223K–600K tokens per issue: highest recall, but 2–40× the cost of a fixed-budget retriever.\[4\] | High |
| Cheapest strong model for exploration | Claude Haiku 5.5: $0.10/MTok input, $0.50 output for prompts ≤100K tokens; $0.50/$2.50 above 100K; cache hits $0.01/MTok.\[5\] | High (official pricing page) |
| Prompt caching | 5-min write 1.25×, 1-hour write 2×, reads 0.1× base (0.05× on Opus 5.5 and Sonnet 5.5). The 5-minute cache pays off after 1 read, the 1-hour cache after 2. Stacks with the Batch discount.\[5\] | High (official) |
| Batch API | 50% off all tokens; most batches finish in under 1 hour, within a 24-hour window.\[6\] | High (official) |
| Structured outputs | GA since Feb 4 2026: JSON outputs (`output_config.format`) and strict tool use (`strict: true`), on every model. Incompatible with citations.\[7\]\[8\]\[9\] | High |
| Best orchestration for your timeline | Own DB-backed state machine. LangGraph `interrupt()`+checkpointer is the best framework fallback. | Judgement |
| Closest existing competitor to your exact product | Spec Workflow MCP (Pimzino): Requirements → Design → Tasks with a web approval dashboard, ~4.3k stars (GPL-3.0). Examiners may know it. | High |

## Details

### 1. Retrieval for Case B without paid embeddings

**Why the previous attempt failed is now moot.** Voyage changed terms on 2026-09-28: free tokens were removed from voyage-code-3 (now $0.18/MTok from the first token), and Batch API usage no longer counts against free credits.\[10\] The current voyage-4 family still has 200M free tokens per account.\[11\] Higher throughput, however, is spend-gated: usage tier 3 requires at least $1,000 paid.\[10\] For a student team, rate limits, not per-token price, are the blocker. That is the right reason to drop it.

**Option-by-option assessment:**

| Option | Quality for "find the files/modules a feature touches" | Infra cost | Token cost | Verdict |
|---|---|---|---|---|
| Pure agentic search (ripgrep/glob/read + Claude) | Best recall in published comparisons, but wanders on large repos | None | High: 223K–600K tokens per issue in the SpIDER measurement | **Core of the design**, but budget-capped |
| Lexical (SQLite FTS5 / BM25) | Strong on identifiers, names and error strings; weak on paraphrase | Zero (FTS5 ships inside SQLite) | Zero LLM tokens | **Include** as a candidate generator / tool |
| Postgres full-text / tantivy | Same class as FTS5 | Postgres FTS is free if you already run Postgres; tantivy adds a Rust dependency | Zero | FTS5 or Postgres FTS is enough; skip tantivy |
| Structural (tree-sitter repo map, Aider-style) | Very good "table of contents": Aider parses definitions/references with tree-sitter, ranks with personalised PageRank (NetworkX), and packs the top symbols into a token budget (default 1,024 tokens)\[12\]\[13\] | Zero | ~1–8K tokens per call | **Include**; this is the cheapest high-leverage piece |
| Generated per-module CLAUDE.md summaries | Gives the agent a map before it searches; matches Anthropic's "up-front" half of the hybrid | One-time LLM cost | Small, and cacheable | **Include**; generate with Batch API + Haiku |
| Local embeddings (bge-small, nomic-embed-text via Ollama) | Helps paraphrase queries; adds index staleness | Free; nomic-embed-text is 137M params / 274MB and runs on a laptop CPU (~180 embeddings/s reported on an M2 Pro); bge-small-en-v1.5 is 33.4M params\[14\]\[15\]\[16\] | Zero LLM tokens | **Optional stretch / ablation only** |
| Hybrid static embeddings + BM25 (e.g., MinishLab Semble, potion-code-16M) | Vendor claims "98% fewer tokens than grep+read" and 99% of a 137M transformer's retrieval quality\[17\] | CPU-only, no API keys\[18\] | Low | Interesting ablation; the claim is vendor-reported, and HN commenters noted it measures retrieval, not end-to-end agent success\[17\] |
| Prompt caching of large codebase chunks | Doesn't retrieve anything; it makes *re-reading* the same context cheap | — | Cuts repeated-prefix cost by 90–95% | **Use inside every agent loop** |

**What the community actually ships:**
- **Continue.dev** shipped local embeddings (transformers.js, LanceDB in `~/.continue`) and later deprecated its `@Codebase` provider. The migration guide now says agent mode "can now use file exploration and search tools to understand your codebase" plus `.continue/rules` files.\[19\]\[20\] That is the same shift Anthropic made.
- **Cursor** uses proprietary embeddings stored in Turbopuffer (cloud) with Merkle-tree sync.\[21\] You can't replicate that for free, and it isn't needed.
- **Hacker News** (Semble thread, "RAG Obituary" thread) is split. Grep/agentic wins for code identifiers. Embeddings still win on vocabulary mismatch in prose corpora. An arXiv paper, "Is Grep All You Need?" (May 2026), found grep generally beat vector retrieval on 116 LongMemEval questions.\[22\]\[23\] That benchmark is conversational memory, not code, so treat it as directional.

**Recommended Context Agent design (4 stages):**
1. **Stage 0 — deterministic scan (free, no LLM):** ripgrep file inventory respecting .gitignore; parse manifests (package.json, requirements.txt, pom.xml, etc.) for dependencies; build a tree-sitter definitions/references graph and a PageRank-ranked repo map. Index file paths, symbols and comments into SQLite FTS5.
2. **Stage 1 — module summaries (one-time per repo, cheap):** one Haiku 5.5 call per top-level module, submitted through the Batch API (50% off). Write `.sdd/context/<module>.md` with purpose, public interfaces, dependencies and owners (from git log). Regenerate only for modules whose git hash changed.
3. **Stage 2 — budgeted agentic loop:** Haiku 5.5 with tools `repo_map(focus)`, `fts_search(q)`, `rg(pattern, glob)`, `read(path, start, end)`, `list_dir(path)`. Hard caps: 25 tool calls, and the prompt kept **under 100K tokens** so it stays in Haiku 5.5's low price band. Use 5-minute prompt caching on the system prompt + repo map + summaries prefix.
4. **Stage 3 — grounding verifier (your research contribution):** the agent must emit `context.json` via strict tool use: `{file, line_start, line_end, symbol, claim, relevance}`. Deterministic code then checks each path exists, each line range is valid, and each symbol actually appears in the range. Unverifiable claims are dropped or flagged before requirements.md/design.md generation.

**Cost estimate per brownfield feature** (my arithmetic from official prices; assumes ~20 exploration turns averaging 40K-token prompts with ~90% cache hits; spec documents with 2 clarification rounds and 1 design revision; excludes Claude Code implementation):

| Step | Model | Est. tokens | Est. cost |
|---|---|---|---|
| Context exploration | Haiku 5.5 (cached) | ~800K in (720K cache reads), 15K out | **~$0.03** (≈$0.09 without caching) |
| Context exploration (alternative) | Sonnet 5.5 (cached) | same | ~$0.42 (≈$1.75 without caching) |
| requirements.md + clarifications | Sonnet 5.5 | ~90K in, 12K out | ~$0.20 |
| design.md | Sonnet 5.5 | ~100K in, 16K out | ~$0.29 |
| tasks.md | Sonnet 5.5 (or Haiku 5.5 at ~1/20th) | ~40K in, 6K out | ~$0.14 |
| **Total spec pipeline** | | | **~$0.65 (Haiku context) to ~$1.05 (Sonnet context)** |
| One-time module summaries, 200-file repo | Haiku 5.5 Batch | ~400K in, 40K out | ~$0.03 |

Add ~30% headroom: Anthropic notes Claude 4.7+ models use a tokenizer that "produces approximately 30% more tokens for the same text."\[5\] Greenfield (Case A) skips the context step and costs roughly $0.60 per feature.

### 2. Orchestration with approval gates

| Option | Suspend/resume at human gates | Durable across days/restarts | Fit for 15–20 days with juniors | Verdict |
|---|---|---|---|---|
| **Hand-rolled DB state machine** (Postgres or SQLite + Next.js API routes; optional XState for the transition table) | You define it: a `status` column plus allowed-transition table; "suspend" = the agent finishes and writes a proposal, "resume" = an approve/reject API call | Yes, trivially (it's a row) | Highest: plain CRUD, no framework semantics to learn | **Recommended** |
| LangGraph (Python or JS) | `interrupt(payload)` inside a node + checkpointer; resume with `Command(resume=value)` on the same `thread_id`\[24\] | Yes with SqliteSaver/PostgresSaver (not MemorySaver) | Medium. Gotcha: on resume, the node re-executes from the start, so side effects before `interrupt()` run again and must be idempotent\[25\] | Best framework fallback |
| Mastra (TypeScript) | `suspend()` / `run.resume({ step, resumeData })`, snapshots persisted in storage, `bail()` for rejection\[26\]\[27\]\[28\] | Yes with Postgres storage | Medium. ~29.4k stars and active, but still churning: issue #26907 (opened Oct 13 2026) had Studio showing a resumed run as Suspended and asking for approval again; fixed Oct 15\[29\]\[30\] | Viable if you want TS + a dev UI |
| Claude Agent SDK | `canUseTool` callback pauses a tool call until your code answers; sessions can be `resume`d/forked by session ID\[31\]\[32\] | Session = conversation history, "not the filesystem," and not a workflow state\[32\] | Good for *inside* one agent (e.g., Context Agent tool approval) | Use per-agent, not as the orchestrator |
| Claude Code as orchestrator (sub-agents + slash commands + hooks) | Possible as a plugin, but stage transitions are decided by the model following instructions. Anthropic's hooks reference warns: "don't count on a stalled hook to act as a gate"\[33\] | No server-side state of record | Low for governance | Use only for implementation (see below) |
| Temporal / Inngest | Excellent durable execution | Yes | Low: new runtime, workers, concepts | Overkill |

**Recommended state machine** (orchestrator is the only writer of `status`; agents only write proposal artifacts):

`CREATED → [CONTEXT_SCANNING → CONTEXT_READY]* → REQ_DRAFTING → REQ_AWAITING_CLARIFICATION ⇄ REQ_DRAFTING → REQ_AWAITING_APPROVAL → REQ_APPROVED → DESIGN_DRAFTING → DESIGN_AWAITING_APPROVAL → DESIGN_APPROVED → TASKS_GENERATED → READY_FOR_IMPLEMENTATION → IMPLEMENTING → DONE` (plus `CHANGES_REQUESTED` loops back to the drafting state; `*` = Case B only)

Implementation rules:
- every transition is a function `transition(specId, from, to, actor, expectedVersion)` with optimistic locking, written to an append-only `audit_log`;
- artifacts are versioned rows (`artifact_versions`) and approval binds to a content hash;
- design drafting refuses to start unless the approved requirements hash matches.

This is roughly 300–500 lines of TypeScript and directly demonstrates the governance requirement to examiners.

**Implementation hand-off via MCP + Claude Code plugin:**
- Build a small MCP server (TypeScript SDK) exposing `get_approved_spec`, `next_task`, `start_task`, `complete_task(evidence)`.
- Package it as a Claude Code plugin. Plugins bundle skills, sub-agents, slash commands, hooks and MCP servers.\[34\]\[35\]
- The plugin includes a `/sdd-implement` skill and a **PreToolUse hook** that queries the orchestrator and explicitly returns `deny` for Edit/Write calls when the spec isn't in `READY_FOR_IMPLEMENTATION`/`IMPLEMENTING`. Hooks run before every other permission check, even in bypassPermissions mode, so this is real enforcement.\[32\]\[36\] Note the hook must return a decision quickly, not stall.

### 3. Using Claude's features to minimise cost

**Current prices (official pricing page, per MTok input/output; cache-hit price):**

| Model | Input | Output | Cache hit | Use in this pipeline |
|---|---|---|---|---|
| Haiku 5.5 | $0.10 (≤100K) / $0.50 (>100K) | $0.50 / $2.50 | $0.01 / $0.05 | Context exploration, module summaries, task breakdown, all development/testing runs |
| Sonnet 5.5 | $2 | $10 | $0.10 (0.05×)\[5\] | Requirement Agent (clarifying questions), Design Agent, demo runs |
| Opus 5.5 | $4 | $20 | $0.20 (0.05×)\[5\] | Optional: final design review on demo day only |
| Haiku 4.5 | $1 | $5 | $0.10\[5\] | No reason to use; Haiku 5.5 is 10× cheaper |

**Prompt caching: what it actually saves.**
- **Within an agent loop:** a 50K-token prefix reused 10 times on Sonnet 5.5 costs $1.00 uncached vs ~$0.17 cached (one 1.25× write + nine 0.05× reads), an ~83% saving.
- **Across human gates:** reviewers take longer than 5 minutes, so the default cache will expire. A 1-hour write (2×) breaks even only after two reads.\[5\] Don't try to keep the cache warm across approvals. Persist a compact `context.json` bundle and rebuild the prefix.
- **Byte-identical prefixes:** cache hits need 100% identical prefixes.\[37\] Put stable content first (system prompt → compliance pack → repo map → module summaries → approved artifacts) and never put timestamps or IDs in the prefix.
- **Minimum length:** the minimum cacheable prefix is model-dependent (512–4,096 tokens per one third-party summary).\[38\]

**Batch API (50% off, stacks with caching):**
- **Use for:** module-summary generation on brownfield onboarding, nightly regeneration of changed modules, and your entire evaluation suite (dozens of runs × strategies).
- **Don't use for:** interactive agents, because humans are waiting.

**Streaming vs batch:** streaming has no price difference; it's UX. Stream drafts to the UI. Batch is the only cost lever.

**Structured outputs to avoid retry waste:**
- Have each agent emit its proposal through strict tool use (`strict: true`) with a JSON Schema, e.g. requirements as `{id, ears_statement, acceptance_criteria[], source_refs[], compliance_refs[]}`.
- Render the markdown deterministically from JSON. That removes parse-failure retries and makes traceability IDs reliable.
- Keep schemas flat and small.
- Structured outputs are incompatible with citations, so do grounding through your own `source_refs` + verifier.

**Development discipline:**
- Run everything on Haiku 5.5 during days 1–17.
- Log `cache_read_input_tokens` / `cache_creation_input_tokens` from every response into a `llm_calls` table.
- Set a hard per-run dollar cap in the orchestrator.

### 4. What already exists: use, borrow, or ignore

| Tool | What it does | Free / license | Activity (checked) | Enforces approval gates? | Recommendation |
|---|---|---|---|---|---|
| **GitHub Spec Kit** | Installs commands/skills into 41 coding agents.\[39\] Flow: `/speckit-constitution → specify → clarify → plan → checklist → tasks → analyze → implement → converge`. Writes `specs/NNN-feature/spec.md, plan.md, tasks.md` and `.specify/memory/constitution.md`\[39\] | MIT, free | ~147K stars (Nov 2026); 1.0 shipped Aug 21 2026; specify-cli 1.3.0 on PyPI with releases through Nov 3 2026\[40\]\[41\]\[42\] | No. Gates "only work if a human actually reads what comes out of them"\[39\] | **Borrow** the constitution concept, templates, and `analyze`/`converge` ideas (MIT). Don't fork as your orchestrator: it is prompt templates executed inside an agent's chat |
| **OpenSpec** (Fission AI, YC W26) | Lightweight SDD: propose → apply → archive; separates current `openspec/specs/` from proposed `openspec/changes/`; "built for brownfield"\[43\]\[44\]\[45\] | MIT, free | ~74.1K stars; npm 1.13.0 published early Nov 2026; weekly cadence\[44\]\[46\]\[47\] | No, it's workflow guidance | **Borrow** the delta-spec model (current vs change) for Case B |
| **BMAD-METHOD** | 21 agent personas, 50+ workflows, PRD/architecture/stories\[48\] | MIT (names trademarked by BMad Code, LLC)\[49\] | ~54.2K stars; v6.12.4 (Oct 14 2026); v7 in preview alpha\[49\]\[50\]\[51\] | Human-in-loop by convention | **Ignore** for build; too heavy. Cite as related work |
| **Kiro (AWS)** | IDE that writes `.kiro/specs/<feature>/requirements.md, design.md, tasks.md`\[52\] | Proprietary. Free 50 credits/mo; Pro $20/1,000 credits; Power $200/10,000; add-ons $0.04/credit. **Students: 1,000 credits/month free for 12 months**\[53\]\[54\] | GA | Yes, inside the IDE | **Use as your evaluation baseline** via the free student plan; don't build on it |
| **Spec Workflow MCP** (Pimzino) | MCP server: Requirements → Design → Tasks, real-time web dashboard, VS Code extension, `request-approval`/`get-approval-status` tools, approve/reject/revise\[55\]\[56\] | Free, open source under GPL-3.0 (copyleft, unlike the MIT tools here: copying its code would bring copyleft obligations, so borrow ideas, not code) | ~4.3k stars, 357 forks; created Aug 7 2025, last pushed Jul 3 2026; forks by Uniswap and others | Approval is requested by the AI through MCP tools; I could not verify that the server blocks progression without approval\[57\] | **Study closely**: it is the nearest thing to your product. Your answer to "why not this?" is server-enforced state, codebase grounding verification, and compliance traceability |
| **Claude Code plugins / skills / sub-agents / slash commands** | Plugins bundle skills, sub-agents, commands, hooks and MCP servers. Commands and skills are now unified (`.claude/commands/x.md` and `.claude/skills/x/SKILL.md` both create `/x`). Skills follow the open Agent Skills standard\[58\]\[59\] | Free (Claude Code usage billed to API) | Official marketplace listed 314 plugins (Sept 2026)\[60\] | Only via hooks you write | **Use for the implementation phase** (plugin + MCP + PreToolUse hook) |
| **Anthropic Agent Skills as agent prompts** | Yes: a SKILL.md + supporting files can hold each agent's instructions and the compliance pack. The same content can be loaded as the system prompt in your Messages API calls | Open standard | — | — | **Do it**: one source of truth for prompts used by both your orchestrator and Claude Code |

### 5. 20-day plan for 4 people

**Stack (all free except Claude API):** TypeScript everywhere; Next.js (App Router) for UI + API routes; Postgres via Docker (or SQLite with better-sqlite3 for zero-ops); Drizzle or Prisma; `@anthropic-ai/sdk`; MCP TypeScript SDK; ripgrep; tree-sitter (node bindings) + a small PageRank (graphology); SQLite FTS5; GitHub Actions for CI. One language lowers the junior learning curve.

**Roles:**
- **You (Lead):** state machine, transitions/audit log, Context Agent (stages 0–3), grounding verifier, eval design.
- **Junior A (Frontend):** Next.js screens — new spec, clarification Q&A, artifact viewer with diff between versions, approve/reject/request-changes with comment, audit timeline, cost meter.
- **Junior B (Agents & prompts):** Requirement/Design/Task agent prompts as SKILL.md files, JSON schemas, markdown renderers, compliance pack content.
- **Junior C (Integration & eval):** MCP server + Claude Code plugin + PreToolUse hook; eval harness, test repos, Batch API jobs.

| Days | Lead | Junior A | Junior B | Junior C | Exit criterion |
|---|---|---|---|---|---|
| 1 | Data model, transition table, JSON schemas frozen | Next.js scaffold, auth stub | Spec templates (borrow Spec Kit/Kiro structure), EARS requirement format | MCP server skeleton, plugin skeleton | Schemas + state diagram merged |
| 2–4 | Orchestrator: `transition()`, versioned artifacts, audit log, cost cap | Create-spec + clarification Q&A screens | Requirement Agent (strict tool output, clarification questions) | `get_approved_spec`, `next_task`, `complete_task` tools | Requirement stage runs E2E with approval |
| 5–7 | Design + Task stage wiring, hash-bound approvals | Approval UI, version diff, audit timeline | Design Agent, Task Agent, renderers to requirements.md/design.md/tasks.md | PreToolUse hook that denies edits unless state allows; `/sdd-implement` skill | Claude Code implements tasks from an approved spec |
| 8–10 | Hardening, idempotency, error states | Polish, cost meter | Compliance pack v0 (GST invoice + TDS Section 393) as a skill | Greenfield demo scripts ×2; CI | **Case A done end-to-end** |
| 10–12 | Context Agent stage 0 (scan, manifests, tree-sitter repo map, FTS5) | Context view (files, evidence, verified/unverified badges) | Brownfield variants of prompts (delta specs, OpenSpec-style) | Pick 3 OSS repos; mine 10–15 feature commits each as ground truth (files touched) | Repo map + FTS work on all 3 repos |
| 12–15 | Agentic loop with budget caps + grounding verifier; CONTEXT states | Wire Case B flow | Requirements/design consume `context.json`; cite `source_refs` | Module-summary generation via Batch API | **Case B runs end-to-end** |
| 15–17 | Run ablations | Results dashboard | Prompt fixes from failures | Eval harness: recall@k of gold files, tokens, $ per strategy | Results table produced |
| 18–20 | Report, defence prep | Demo recording | Kiro (free student plan) baseline on same features | Buffer / bug fixes | Freeze day 19 |

**Research contribution vs plumbing:**
- **Contribution:** (a) a controlled comparison on real repos of retrieval strategies for spec grounding — grep-only agentic vs repo-map + agentic vs FTS5 + repo-map + agentic, plus optional local embeddings — measured by file recall against git-history ground truth, tokens and dollars; (b) the grounding verifier and its "unverified-claim rate" metric; (c) compliance traceability coverage.
- **Plumbing:** UI, CRUD, MCP wiring, renderers.

**Top risks and mitigations:**
1. *Agentic loop cost blow-up.* Mitigate with hard tool-call caps, the <100K prompt rule, and a per-run $ cap.
2. *Juniors blocked on the lead.* Freeze schemas on day 1 so all four tracks proceed in parallel against fixtures.
3. *tree-sitter grammar issues.* Restrict eval repos to 1–2 languages (e.g., TypeScript + Python).
4. *Claude Code implementation cost.* It runs on API tokens and is the largest variable cost. Implement only 1–2 tasks per demo feature.
5. *Scope creep into compliance content.* Cap the pack at ~15 rules.

### 6. The differentiator

Spec Kit, OpenSpec, BMAD, Kiro and Spec Workflow MCP all produce requirements/design/tasks documents, so a document generator is not defensible. What none of them claims:

1. **Server-enforced governance:** stage transitions owned by a deterministic orchestrator with hash-bound approvals and an audit log, plus a Claude Code hook that blocks edits outside approved state. In the other tools, gates are conventions the model or human is trusted to follow.
2. **Evidence-checked brownfield specs:** every codebase claim in design.md carries a file:line reference that is mechanically verified. You report a measurable hallucination metric (unverified-claim rate) and the retrieval ablation.
3. **Compliance-as-acceptance-criteria:** a versioned compliance skill injects testable criteria into requirements and traces them to tasks and tests.

**Is the Indian SMB compliance angle worth playing?** Yes, narrowly:
- **TDS is a timely, concrete demo.** The Income-tax Act 2025 took effect on 1 April 2026, and the 194-series sections no longer exist ("There is no 194C, 194I or 194J in the new Act. Each is now a row in the table in Section 393").\[61\]\[62\] Technical-service fees are now 2% (payment code 1026) and professional fees 10% (code 1027); contractor payments are 1% for individuals/HUF and 2% for others.\[62\]\[63\] A pipeline that rejects a design citing "Section 194J" and maps it to Section 393 is a crisp demo of why compliance packs must be versioned.
- **GST e-invoice:** use the public schema/field documentation offline. Don't promise live integration: NIC's e-invoice sandbox registration requires a GSP, a GSTN-shortlisted ERP, or an eligible taxpayer GSTIN (turnover above ₹5 crore per NIC release notes), verified by OTP.\[64\]\[65\] The e-way bill API likewise requires GSTN short-listing.\[66\]
- **ABDM:** drop it. Sandbox access requires organisation details and NHA approval, and callbacks need a public HTTPS server.\[67\]\[68\] Individual student access is unconfirmed.
- **Vernacular:** accept Hindi/Hinglish business requirements as input and produce English specs. It's nearly free with Claude and shows well in a demo, but don't make it the thesis.

## Recommendations (start Monday)

1. Delete the Voyage/pgvector code path. Build the Context Agent as: tree-sitter repo map + SQLite FTS5 + budgeted Haiku 5.5 agentic loop + grounding verifier; per-module summaries via Batch API.
2. Build your own Postgres-backed state machine; keep LangGraph (with SqliteSaver/PostgresSaver) as the documented fallback. Don't adopt Temporal/Inngest.
3. Put all agent prompts and the compliance pack in SKILL.md files; call them from the Messages API with strict tool use; render markdown deterministically.
4. Ship the implementation phase as a Claude Code plugin: MCP server + `/sdd-implement` skill + PreToolUse hook that denies edits outside approved states.
5. Develop on Haiku 5.5; switch Requirement/Design agents to Sonnet 5.5 for demos; log every call's cache and token fields; set a per-run cost cap.
6. Borrow (with MIT attribution) Spec Kit's constitution/templates and OpenSpec's delta-spec model; use Kiro's free student plan as a baseline; position explicitly against Spec Workflow MCP in the report.
7. Defend the project on three measurable claims: retrieval recall per dollar, unverified-claim rate, and compliance traceability coverage.

## Caveats

- Per-feature cost figures are my estimates from official per-token prices and assumed token counts, not measurements. Measure them in week 1 and revise.
- Haiku 5.5's quality for code exploration is not benchmarked here. If it underperforms, the Sonnet 5.5 context step (~$0.42/feature cached) is the fallback.
- Anthropic's anti-RAG position comes from internal experience: Cherny described it on the Latent Space podcast as "mostly vibes", with "some internal benchmarks also". Published evidence is mixed: agentic search has the highest recall but much higher token cost (SpIDER), and some vendors report large token savings from hybrid lexical+static-embedding search. Your ablation is what turns this into evidence.
- The "Is Grep All You Need?" result is on LongMemEval (conversational memory), not codebases.
- GitHub star counts come from different snapshot dates (Sept–Nov 2026) and sources.
- TDS thresholds have a source conflict: most sources give ₹50,000 and codes 1026/1027 for professional/technical fees, but one gives ₹30,000 and codes 1030/1031.\[69\]\[70\] Confirm against the CBDT/Income Tax portal before encoding rules.

## What I could not verify

- Whether Spec Workflow MCP's server *enforces* approvals or only records them. Its license (GPL-3.0), star count (~4.3k) and last push (Jul 3 2026) are confirmed.
- LangGraph and Claude Agent SDK GitHub star counts and latest release dates (not checked in this pass).
- Whether BMAD v7 shipped on its stated Oct 16 2026 ETA.\[49\]
- Reddit r/LocalLLaMA and r/MachineLearning discussions on code retrieval: not reviewed directly; community evidence above comes from Hacker News threads and tool documentation.
- Semble's benchmark claims (98% fewer tokens, 99% quality): vendor-reported, not independently verified.
- Whether NIC has added a developer/student registration category for the e-invoice or e-way bill sandbox since 2024 (login-gated pages not checked).
- Whether the ABDM sandbox accepts a university as the registering organisation for a student project.
- The exact minimum cacheable prefix length for Haiku 5.5 and Sonnet 5.5.
- Claude Code implementation-phase token cost per task on your repos (highly variable; measure it).

## Sources

1. [Boris Cherny on X: "@EthanLipnik 👋 Early versions of Claude Code used RAG + a local vector db, but we found pretty quickly that agentic search generally works better. It is also simpler and doesn’t have the same issues around security, privacy, staleness, and reliability." / X](https://x.com/bcherny/status/2017824286489383315)
2. [Effective context engineering for AI agents \\ Anthropic](https://www.anthropic.com/research/effective-context-engineering-for-ai-agents)
3. [Effective Context Engineering for AI Agents](https://gettingautomated.com/curated-resources/anthropic-effective-context-engineering)
4. [SpIDER: Spatially Informed Dense Embedding Retrieval for Software Issue Localization](https://arxiv.org/pdf/2512.16956)
5. [Pricing](https://platform.claude.com/docs/en/about-claude/pricing)
6. [Batch processing - Claude Platform Docs](https://platform.claude.com/docs/en/build-with-claude/batch-processing)
7. [Structured outputs - Claude Platform Docs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)
8. [Structured outputs on the Claude Developer Platform](https://claude.com/blog/structured-outputs-on-the-claude-developer-platform)
9. [Structured Outputs Across AI APIs: OpenAI, Claude, Gemini (2026)](https://www.developersdigest.tech/blog/structured-outputs-across-ai-apis-2026)
10. [Voyage AI Pricing](https://www.usagepricing.com/blueprint/voyage-ai)
11. [Voyage AI Pricing 2026: Voyage 4 vs OpenAI and Gemini](https://mxchat.ai/voyage-ai-pricing-chatbot-test/)
12. [How to Manage the Aider Context Window and Token Budgets](https://fast.io/resources/aider-context-window/)
13. [Repository Mapping System](https://deepwiki.com/Aider-AI/aider/4.1-repository-mapping-system)
14. [Best free open-source embedding models 2026 — supermemory](https://supermemory.ai/blog/best-open-source-embedding-models-benchmarked-and-ranked/)
15. [Nomic Embed Text: The Most-Pulled Ollama Embedding Model, Explained](https://localaimaster.com/models/nomic-embed-text)
16. [Local AI Embeddings: Models, APIs, and Integration (2026 Guide)](https://localaimaster.com/blog/local-ai-embeddings-guide)
17. [Show HN: Semble](https://news.ycombinator.com/item?id=48169874)
18. [Semantic Code Search vs Grep for Coding Agents 2026](https://particula.tech/blog/semantic-code-search-vs-grep-coding-agents)
19. [Local Continue - VS Code Package Security Analysis - Socket](https://socket.dev/vscode/package/doctorliang-continue.local-continue)
20. [How to Make Agent mode Aware of Codebases and Documentation](https://docs.continue.dev/guides/codebase-documentation-awareness)
21. [Feature: Knowledgebase RAG System — User-Configured Document Directory with Local Embedding, Hybrid Search & Auto-Retrieval · Issue #844 · NousResearch/hermes-agent · GitHub](https://github.com/NousResearch/hermes-agent/issues/844)
22. [Is Grep All You Need? Grep vs Vector Retrieval for Agentic Search - DEV Community](https://dev.to/pueding/is-grep-all-you-need-grep-vs-vector-retrieval-for-agentic-search-534k)
23. [This glosses over a fundamental scaling problem that undermines the entire argum...](https://news.ycombinator.com/item?id=45445280)
24. [LangGraph.js human-in-the-loop in TypeScript (2026): interrupt, Command resume, PostgresSaver checkpointer, and Mastra vs Inngest AgentKit — Cadenya](https://cadenya.com/other-content/langgraph-js-human-in-the-loop)
25. [LangGraph Human-in-the-Loop Tutorial (2026): interrupt() + Command](https://www.agentnotebook.dev/tutorials/langgraph-human-in-the-loop)
26. [Human-in-the-loop](https://mastra.ai/docs/workflows/human-in-the-loop)
27. [mastra/docs/src/content/en/docs/workflows/suspend-and-resume.mdx at main · mastra-ai/mastra · GitHub](https://github.com/mastra-ai/mastra/blob/main/docs/src/content/en/docs/workflows/suspend-and-resume.mdx)
28. [Suspend & Resume](https://mastra.ai/docs/v0/workflows/suspend-and-resume)
29. [\[BUG\] Studio shows a resumed workflow run as Suspended and asks for approval again · Issue #26907 · mastra-ai/mastra · GitHub](https://github.com/mastra-ai/mastra/issues/26907)
30. [GitHub - mastra-ai/mastra: Mastra is the modern TypeScript framework for AI-powered applications and agents. · GitHub](https://github.com/mastra-ai/mastra)
31. [Handle approvals and user input - Claude Code Docs](https://code.claude.com/docs/en/agent-sdk/user-input)
32. [Claude Agent SDK: The Production Guide to Tracing, Subagents, and Evaluation](https://inference.net/content/claude-agent-sdk-production-guide/)
33. [Hooks reference - Claude Code Docs](https://code.claude.com/docs/en/hooks)
34. [claude-code/plugins/README.md at main · anthropics/claude-code · GitHub](https://github.com/anthropics/claude-code/blob/main/plugins/README.md)
35. [Best Claude Code Plugins 2026: 62 Agentic Workflow Tools](https://www.matthewswong.com/en/blog/claude-code-plugins-marketplace-guide/)
36. [The Claude Developer Guide Agent SDK Reference — Guides](https://blog.gopenai.com/the-claude-developer-guide-agent-sdk-reference-guides-92c0c2f3b3ef?gi=9e3c241efa82)
37. [Anthropic’s 0.1x Cache Read Only Pays If Context Freezes](https://medium.com/kairi-ai/anthropics-0-1x-cache-read-only-pays-if-context-freezes-2094883cb3f7)
38. [Prompt Caching breakdown: Cut token spend in 2026](https://www.flexera.com/blog/ai/prompt-caching-breakdown/)
39. [GitHub Spec Kit: How Spec-Driven Development Turns AI Agents from Vibe Coders into Engineers](https://www.paperclipped.de/en/blog/github-spec-kit-spec-driven-development/)
40. [specify-cli · PyPI](https://pypi.org/project/specify-cli/)
41. [GitHub Spec Kit Review for Production Teams - Wavect.io](https://wavect.io/blog/github-spec-kit-production-guide/)
42. [GitHub Trending November 2026: From a 147K-Star Spec-Driven Toolkit to a 2.78-Trillion-Parameter Model Running on 8GB RAM — 5 Repos That Prove the Agent Era's Next Frontier Is Determinism, Not Capability](https://www.coddykit.com/pages/blog-detail?id=5130021&slug=github-trending-november-2026-from-a-147k-star-spec-driven-toolkit-to-a-2-78-tri)
43. [spec-compare/docs/tools/openspec.md at main · cameronsjo/spec-compare · GitHub](https://github.com/cameronsjo/spec-compare/blob/main/docs/tools/openspec.md)
44. [GitHub - Fission-AI/OpenSpec: Spec-driven development (SDD) for AI coding assistants. · GitHub](https://github.com/Fission-AI/openspec)
45. [OpenSpec: Make AI Coding Assistants Follow a Spec, Not Just Guess - DEV Community](https://dev.to/recca0120/openspec-make-ai-coding-assistants-follow-a-spec-not-just-guess-22dp)
46. [OpenSpec - Learn AI](https://ai.miraheze.org/wiki/OpenSpec)
47. [fission-ai/openspec](https://www.npmjs.com/package/@fission-ai/openspec)
48. [GitHub - evolution-foundation/BMAD-METHOD-BY-EVOLUTION: Breakthrough Method for Agile Ai Driven Development · GitHub](https://github.com/EvolutionAPI/BMAD-METHOD-BY-EVOLUTION)
49. [BMAD-METHOD/README.md at main · bmad-code-org/BMAD-METHOD · GitHub](https://github.com/bmad-code-org/BMAD-METHOD/blob/main/README.md)
50. [bmad-method](https://security.snyk.io/package/npm/bmad-method)
51. [BMad Code](https://www.bmadcode.com/)
52. [Kiro Review 2026: Specs, Tests, Pricing and Safety](https://axonbuild.com/blog/kiro-ide-review/)
53. [Pricing - Kiro](https://kiro.dev/pricing/)
54. [Kiro Pricing 2026: Free 50 Credits, Pro \$20 & Student Plan](https://promoclock.co/en/tools/kiro/)
55. [GitHub - Uniswap/spec-workflow-mcp: A Model Context Protocol (MCP) server that provides structured spec-driven development workflow tools for AI-assisted software development, featuring a real-time web dashboard for monitoring and managing your project's progress. · GitHub](https://github.com/Uniswap/spec-workflow-mcp)
56. [GitHub - Pimzino/spec-workflow-mcp: A Model Context Protocol (MCP) server that provides structured spec-driven development workflow tools for AI-assisted software development, featuring a real-time web dashboard and VSCode extension for monitoring and managing your project's progress directly in your development environment. · GitHub](https://github.com/Pimzino/spec-workflow-mcp)
57. [spec-workflow-mcp/docs/USER-GUIDE.md at main · Pimzino/spec-workflow-mcp · GitHub](https://github.com/Pimzino/spec-workflow-mcp/blob/main/docs/USER-GUIDE.md)
58. [A Mental Model for Claude Code: Skills, Subagents, and Plugins](https://levelup.gitconnected.com/a-mental-model-for-claude-code-skills-subagents-and-plugins-3dea9924bf05?gi=410dd28016a5)
59. [Extend Claude with skills - Claude Code Docs](https://code.claude.com/docs/en/skills)
60. [Best Claude Code Skills and Plugins in 2026: Where to Find, Install, and Choose Them](https://www.developersdigest.tech/blog/best-claude-code-skills-2026)
61. [Income-tax Act 2025 vs 1961: Section Mapping Cheat Sheet for Sections You Use Every Day](https://taxguru.in/income-tax/income-tax-act-2025-1961-section-mapping-cheat-sheet-sections-day.html)
62. [Section 393 of Income Tax Act 2025: TDS Tables](https://onefinops.com/blog/section-194-to-393-tds-mapping-guide-fy-2026-27)
63. [TDS New Section Numbers 2026: 194C, 194J vs 393](https://taxgarden.in/blog/income-tax-act-2025-section-393-tds-new-numbers-old-194c-194j-194q)
64. [Sandbox E-Invoice Portal Python API Docs](https://dlthub.com/context/source/sandbox-e-invoice-portal)
65. <https://einv-apisandbox.nic.in/release-notes.html>
66. [On-boarding Process](https://docs.ewaybillgst.gov.in/apidocs/on-boarding-process.html)
67. [ABDM HIU Integration from Scratch: M3 Certification and Health Records Pull Guide](https://nirmitee.io/blog/building-abdm-hiu-from-scratch-m3-flow-reference-architecture/)
68. [ABDM Sandbox Integration and Exit process](https://docs.coronasafe.network/abdm-documentation/implementers-guide/abdm-sandbox-integration-and-exit-process)
69. [Section 393 of Income Tax Act 2025 — Complete TDS Guide for Business Owners & MSMEs](https://one.vittsphere.com/blog/tax-planning/section-393-tds-income-tax-act-2025-business-guide/)
70. [TDS Rate Chart TY 2026-27 with Codes](https://goforfiling.com/tds-rate-chart-ty-2026-27-codes/)
