# Quickstart

Create a spec, answer the agent's questions, cross three approval gates, and hand the
tasks to Claude Code.

## 1. Sign in

[Sign in](/sign-in) or [create an account](/sign-up). Identity matters here: the audit
log records the account that crossed each gate, so an approval names a person rather
than "a reviewer".

## 2. Describe the feature

Open the workspace and type what you want built, in plain prose. Two choices sit under
the composer:

| Choice | What it does |
|---|---|
| **New code** | Greenfield. No repository is read; requirements are drafted straight from your description. |
| **Existing repo** | Brownfield. Adds a context stage that scans the checkout you name and verifies every claim the agent makes about it. |

For an existing repository, give an absolute path to a local checkout. The path is
resolved and checked before the spec is created, so a typo is refused immediately rather
than halfway through a run.

## 3. Answer the clarifying questions

The Requirement Agent asks only what it cannot settle from your description, and at most
two rounds of them. Answer inline in the thread; drafting resumes from your answers.

## 4. Approve the requirements

Open `requirements.md` from the thread. The content hash is shown above the document —
that is what your approval binds to. Choose **Approve** or **Request changes** (which
returns the spec to drafting with your comment attached).

If the document changed between opening it and deciding, the API refuses with
`HASH_MISMATCH` and records nothing.

## 5. Approve the design

The Design Agent drafts from the approved requirements. For a brownfield spec, the
grounding panel above `context.md` shows the unverified-claim rate and lists every claim
that failed verification, with the verifier's reason. Read that before approving.

## 6. Approve the tasks — this is the gate that permits file edits

The Task Agent breaks the approved design into ordered tasks. Approving them moves the
spec to `READY_FOR_IMPLEMENTATION`, and **that edge is what allows Claude Code to edit
files**. It is human-only by construction: the transition table admits no agent actor on
an approval edge.

## 7. Implement

Point Claude Code at the repository with the AgentForge plugin loaded:

```bash
claude --plugin-dir /path/to/agentforge/packages/plugin
```

Pin the session to the spec by writing `.sdd/current-spec` in the repository, or by
setting `SDD_SPEC_ID`. From there the agent calls `next_task`, `start_task`, writes the
code, and `complete_task` with evidence.

The `PreToolUse` hook refuses `Edit`, `Write`, `NotebookEdit` and `MultiEdit` unless the
spec is released **and** a task is claimed, and it fails closed on any internal error.
Its scope is stated plainly in [Core concepts](/docs/concepts#the-edit-hook).

## Do it from the command line instead

```bash
# the deterministic stages, no API key and no cost
npm run sdd:scan -- /path/to/repo

# the implementation phase against a released spec
npm run sdd:smoke:implement -- spec_...
```

See the [API reference](/docs/api) for driving the pipeline over HTTP.
