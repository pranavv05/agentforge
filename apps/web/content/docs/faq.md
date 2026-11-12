# FAQ

## Is the model output real?

Yes. Requirements, design, tasks and the brownfield context scan are produced by real
Claude calls, and every call is recorded to `llm_calls` with its token and cache counters.
Costs quoted anywhere in this product come from that table, computed against a list-price
table that the smoke script re-verifies against the gateway's own reported figure on
every run. The current difference is 0.00%.

The test suite is a different matter: it replays recorded cassettes, so it runs offline,
deterministically and for nothing. That is a property of the tests, not of the product.

## Can I point it at my own repository?

Yes, at a local checkout. A brownfield spec takes an absolute path, and the file
inventory comes from `git ls-files --cached --others --exclude-standard`, falling back to
a Node walk that still honours `.gitignore` for non-checkouts. Getting that wrong is how
a file like `secret.env` ends up in a prompt.

All file tools are confined to the repository root: traversal, absolute paths and
symlinks pointing outside it are refused.

## Do I need an API key?

The server needs one — either `ANTHROPIC_API_KEY` or `OPENROUTER_API_KEY`. There is no
per-user key feature: keys are server configuration, not account settings.

Two useful things need no key at all, because they are deterministic:

```bash
npm run sdd:scan -- <repo>        # inventory, repo map, FTS index, verifier
npm run eval -- <repo>            # the retrieval ablation
```

## Which compliance rules are covered?

GST e-invoice mandatory fields, the applicability threshold and IRN immutability, plus
TDS under Section 393 of the Income-tax Act 2025 — 15 rules in version 1.0.0. Rates and
codes must be verified before real use; see
[Grounding and compliance](/docs/grounding-compliance).

## Why three approval gates and not two?

Because the third one is where file edits become permitted. Approving the tasks moves a
spec to `READY_FOR_IMPLEMENTATION`, which is the state the edit hook checks. Letting an
agent cross that edge would mean an agent deciding when an agent may write to your
repository.

## Can an agent approve its own work?

No, and the audit log is what proves it. Approval edges in the transition table admit
only `actor.type === 'human'`, and the HTTP layer hard-codes requests to `human` so no
caller can impersonate an agent. A full pipeline run is covered by a test asserting all
three gates were crossed by a human and that no audit row was ever written by an agent.

## What stops the context agent running up a bill?

Hard caps: 25 tool calls, a prompt kept under 100K tokens, and a per-run spend ceiling
checked *before* each call rather than after. A measured brownfield scan of this
repository used 15 of those 25 calls and cost $0.0133.

## Which retrieval strategy should I use?

It depends on the repository, and the honest answer is that the most elaborate option is
not the best one everywhere. Measured recall@10 over 15 mined feature commits per
repository:

| Strategy | execa (TypeScript) | requests (Python) |
|---|---|---|
| `grep` | 0.022 | 0.556 |
| `repomap` | 0.117 | 0.565 |
| `fts` | **0.344** | 0.474 |
| `fts_repomap` | 0.233 | **0.598** |

The lexical index is worth 15× grep on one repository and *less* than grep on the other.
Spreads are wide relative to the means, often ±0.3 at n=15, which is the real variance of
the task.

## What is not finished?

- The compliance pack has not been reviewed by a tax professional.
- The ablation compares *retrieval* deterministically. Running the full agentic loop per
  arm per commit would measure the system as used, but costs money per run and varies
  between runs, so the deterministic figures are the ones with a spread behind them.
- Two fixture repositories were used where three were planned.
