---
name: sdd-implement
description: Implement an approved AgentForge spec one task at a time, claiming each task before editing and recording evidence on completion.
---

# Implement an approved spec

You are implementing a spec that a human has already approved. The requirements and the
design are settled; your job is to build what they describe, one task at a time.

## Before you start

Run `get_approved_spec`. It returns the approved requirements, design and task list.
Read all three before touching a file. If `implementation_permitted` is false, stop and
tell the user — the spec has not been released for implementation and your edits will be
refused.

If the user has not said which spec, ask. The session is pinned either by `SDD_SPEC_ID`
or by `.sdd/current-spec` in the repository, and without one these tools cannot tell what
you are meant to be building.

## The loop

1. `next_task` — take the task it gives you. Do not pick one yourself from the task
   list: dependency order is enforced, and a task you choose may be blocked.
2. `get_acceptance_criteria` for that task. These are what "done" means. Judging by eye
   instead is how a task gets marked complete without working.
3. `start_task` — claim it. **You must do this before editing any file.** Edits are
   refused while no task is in progress, so this is not a formality.
4. Implement it. Stay inside the task's scope.
5. Make the acceptance criteria pass, and run the project's tests.
6. `complete_task` with evidence: what you changed, which files, and how you verified it.
7. Repeat until `next_task` returns nothing.

## Rules

**One task at a time.** Claiming a second task while one is in progress is refused. A
change spanning several tasks cannot be reviewed as a unit.

**Do not redesign.** The design was approved. If it is wrong, or a task cannot be done as
specified, say so and stop — do not improvise a different approach. A spec whose
implementation quietly diverged is worse than one that stopped and asked, because nobody
knows which document describes the system.

**Do not edit the spec artifacts.** `requirements.md`, `design.md` and `tasks.md` are
approved records bound to a content hash. Changing them would invalidate the approval.
They are produced by the pipeline, not by you.

**Evidence is not a summary.** "Implemented the validator" is useless. Name the files,
the functions and the tests: "Added `validateGstFields` in `src/billing/gst.ts`; 6 unit
tests in `gst.test.ts` cover each mandatory field, AC-001 and AC-002 pass." That text goes
into the audit trail and is what a reviewer reads later.

**If you are blocked, say so.** A missing dependency, an ambiguous criterion, a test you
cannot make pass — report it rather than marking the task complete. A false completion is
the one outcome this whole system exists to prevent.

## If an edit is refused

The refusal names the reason. The usual two:

- *the spec is not in an implementation state* — requirements or design have not been
  approved, or the spec has not been released. This is not something to work around; tell
  the user what stage it is in.
- *no task is in progress* — call `start_task` first.

Do not try to circumvent the refusal. It is the mechanism that makes the approval
meaningful, and working around it would defeat the purpose of the spec you are
implementing.
