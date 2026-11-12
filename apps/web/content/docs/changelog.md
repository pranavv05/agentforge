# Changelog

## November 2026

### The implementation phase, proven

- The pipeline no longer appears to stop after the Task Agent. Task claims and
  completions are derived from the task rows and shown in the thread with the evidence
  the implementing agent recorded, and live task progress sits beside `tasks.md` —
  which cannot show it itself, being frozen at the hash it was approved under.
- `release_task` closes the last undriven edge in the transition table. A session that
  claimed a task and stopped used to strand a spec in `IMPLEMENTING` with nothing in
  progress, because `start_task` refuses a second claim while one is open.
- Case A was run end to end in a real Claude Code session with the plugin loaded. The
  hook denied an unattributed write; the same session, with a task claimed, implemented
  it and recorded traceable evidence.

### Governance

- Tasks now have their own approval gate. Approving them is what releases a spec for
  implementation, and that edge is human-only — it is the point at which file edits
  become permitted, so an agent should not be able to cross it.
- A reachability audit requires every edge in the transition table to name what drives
  it. The number of edges nothing drives is now zero, and a new one fails the build.

### Grounding and compliance

- The grounding verdict is lifted out of the context document: the unverified-claim
  rate, the counts, and every failed claim with the verifier's own reason. Inside the
  prose, a verified claim and a failed one read identically.
- The marketing pages read the shipped compliance pack rather than their own copy of it,
  so the rule count and version on the site cannot drift from the pack the agents inject.

### Measurement

- Estimated costs are gone. Every figure quoted in the product comes from the `llm_calls`
  table, and the price model is re-verified against the gateway on every smoke run.
- The retrieval ablation publishes recall@10 across four arms and two repositories,
  including the result that the lexical index beats grep 15× on one repository and loses
  to it on the other.

### Interface

- The workspace was rebuilt as a three-pane, chat-driven dashboard: the conversation on
  the left, the document and its decision controls together on the right. Approval is
  not a button in the chat, because binding your name to a content hash should require
  opening the document.
- A new marketing site, documentation, comparisons and resources.
- Narrow screens stack rather than hiding the thread list, which previously left a phone
  with no navigation and no way to get it back.
