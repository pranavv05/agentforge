# Introduction

AgentForge turns a feature request into **requirements, design and tasks**, then hands the
approved tasks to Claude Code. Plenty of tools generate those three documents. The
difference here is that the gates between them are enforced by the server rather than
observed by convention, and every claim an agent makes about your existing code is
mechanically checked before it reaches a document.

## What makes it different

- **Governed.** Agents only ever *propose*. A deterministic orchestrator owns every stage
  change, and only a human can cross an approval gate. Each approval binds to the
  SHA-256 hash of the exact bytes you reviewed, so editing a document invalidates its
  approval rather than silently inheriting it.
- **Grounded.** Statements about an existing codebase are emitted as `file:line` claims.
  Deterministic code then checks that the file exists inside the repository, that the
  line range is valid, and that the named symbol really appears in that range. Claims
  that fail are flagged, and the **unverified-claim rate** is recorded as a measurable
  hallucination metric.
- **Compliant.** A versioned 15-rule GST and TDS pack injects testable Given/When/Then
  acceptance criteria and traces each one from rule to requirement to design to task.

## Who it is for

Teams using AI to write code who need an audit trail between *what was asked for* and
*what the agent was allowed to build*. It is most useful for brownfield work in regulated
domains, where "the model said so" is not an acceptable provenance for a tax rule.

## What it costs to run

Real figures from the `llm_calls` table on live runs through OpenRouter on Haiku 5.5, not
estimates:

| Run | Result |
|---|---|
| Greenfield, `CREATED` → `DESIGN_AWAITING_APPROVAL` | 16 requirements, 11 design sections. **$0.0186** |
| Brownfield scan of a real repository | 15 of 25 tool calls, 11.1% unverified-claim rate. **$0.0133** |

## Next steps

- [Quickstart](/docs/quickstart): drive a spec from a request to approved tasks.
- [Core concepts](/docs/concepts): the pipeline, approvals, the audit log and spend caps.
- [API reference](/docs/api): every route, with the real request shapes.

> **Before you rely on the compliance pack:** it has not been reviewed by a tax
> professional. Rates and payment codes are encoded only where the source research states
> them, known source disagreements are recorded against each rule, and everything else is
> a structural obligation rather than an invented number. Confirm every rate, threshold
> and code against the CBDT portal and the current NIC e-invoice schema before any real
> use. See [Grounding and compliance](/docs/grounding-compliance).
