# Introduction

AgentForge turns a feature request into **requirements, design and tasks**, then hands approved tasks to your coding agent. Unlike other spec tools, every step is enforced by the server and every claim about your code is checked.

## What makes it different

- **Governed.** Agents can only *propose*. A deterministic orchestrator owns every stage change, and humans approve. Each approval is bound to the hash of the exact document you reviewed.
- **Grounded.** Statements about an existing codebase are emitted as `file:line` claims. Deterministic code verifies the file exists, the range is valid and the symbol is really there. The unverified-claim rate is reported.
- **Compliant.** An optional compliance pack (GST e-invoice and TDS under Section 393) injects testable acceptance criteria and traces them from requirement to task.

## Who it is for

Teams that use AI to write code and want an audit trail between *"what we asked for"* and *"what the agent was allowed to build"*. It is most useful for brownfield work in regulated domains such as finance and tax.

## Next steps

- [Quickstart](/docs/quickstart): run your first spec in five minutes.
- [Core concepts](/docs/concepts): the pipeline, approvals, audit log and cost caps.
- [API reference](/docs/api): drive everything from scripts.

> **Demo build.** Model output in this deployment is generated deterministically and priced with a real price table, so no API key is needed. Brownfield runs analyse a bundled sample repository. See [FAQ](/docs/faq#what-is-simulated) for details.
