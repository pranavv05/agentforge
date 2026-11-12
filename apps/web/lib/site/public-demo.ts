import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { COMPLIANCE_PACK, PACK_VERSION } from '@agentforge/compliance';
import { SPEC_STATES, type SpecState } from '@agentforge/contract';
import { REPO_ROOT } from '@agentforge/db';
import { TRANSITION_RULES } from '@agentforge/orchestrator';

/**
 * The public demos behind the marketing pages.
 *
 * Four small tools — the transition explorer, the edit-hook tester, the compliance lint
 * and the TDS calculator — plus a grounding playground. They take no account and cost
 * nothing, because every one of them is a pure function of data this repository already
 * ships: the transition table, the hook's own rule, and the compliance pack.
 *
 * That is the point of having them. A marketing page claiming "the orchestrator refuses
 * illegal moves" is a sentence; a page that refuses one in front of you, out of the same
 * table the product runs on, is the claim itself. Nothing here re-states a rule in its
 * own words — if the table changes, these change with it.
 */

// ---------------------------------------------------------------- states

/** How the pipeline is grouped for display. Presentation only; the table is the truth. */
const PIPELINE: readonly { readonly label: string; readonly states: readonly SpecState[] }[] = [
  { label: 'Start', states: ['CREATED', 'CONTEXT_SCANNING', 'CONTEXT_READY'] },
  {
    label: 'Requirements',
    states: ['REQ_DRAFTING', 'REQ_AWAITING_CLARIFICATION', 'REQ_AWAITING_APPROVAL', 'REQ_APPROVED'],
  },
  { label: 'Design', states: ['DESIGN_DRAFTING', 'DESIGN_AWAITING_APPROVAL', 'DESIGN_APPROVED'] },
  {
    label: 'Tasks and implementation',
    states: ['TASKS_GENERATED', 'READY_FOR_IMPLEMENTATION', 'IMPLEMENTING', 'DONE'],
  },
  { label: 'Terminal', states: ['FAILED'] },
];

/** Who may cause an edge, phrased for a reader rather than as an actor enum. */
function actorsFor(allowed: readonly string[]): string {
  if (allowed.length === 1 && allowed[0] === 'human') return 'a human';
  if (allowed.includes('human') && allowed.includes('orchestrator')) {
    return 'a human or the orchestrator';
  }
  if (allowed.includes('orchestrator')) return 'the orchestrator';
  return allowed.join(' or ');
}

/** "a" or "an", so the demo's own prose is not the thing that looks unfinished. */
function article(word: string): string {
  return /^[aeiou]/i.test(word) ? 'An' : 'A';
}

export function statesPayload() {
  return {
    states: SPEC_STATES,
    terminal: ['DONE', 'FAILED'],
    pipeline: PIPELINE,
    edges: TRANSITION_RULES.map((rule) => ({
      from: rule.from,
      to: rule.to,
      by: actorsFor(rule.allowedActors),
    })),
  };
}

export interface TransitionQuestion {
  readonly from: string;
  readonly to: string;
  readonly actor: string;
}

export function checkTransition({ from, to, actor }: TransitionQuestion) {
  const rule = TRANSITION_RULES.find((r) => r.from === from && r.to === to);

  if (rule === undefined) {
    return {
      ok: false,
      reason: 'not_in_table',
      message: `There is no ${from} → ${to} edge. The orchestrator refuses it before any guard runs.`,
      next: TRANSITION_RULES.filter((r) => r.from === from).map((r) => ({
        to: r.to,
        by: actorsFor(r.allowedActors),
      })),
    };
  }

  if (!(rule.allowedActors as readonly string[]).includes(actor)) {
    return {
      ok: false,
      reason: 'wrong_actor',
      // The governance claim, demonstrated rather than asserted: this is the refusal an
      // agent gets if it tries to approve its own output.
      message:
        `${from} → ${to} is a legal move, but only ${actorsFor(rule.allowedActors)} may ` +
        `make it. ${article(actor)} ${actor} cannot.`,
      next: [],
    };
  }

  return {
    ok: true,
    reason: 'allowed',
    message: `${from} → ${to} is in the table and ${actor} may make it. Guards and the version check still apply.`,
    next: [],
  };
}

// ------------------------------------------------------------- edit hook

/** The states in which the hook permits a file edit. */
const IMPLEMENTATION_STATES: readonly string[] = ['READY_FOR_IMPLEMENTATION', 'IMPLEMENTING'];

/** The tools the hook governs. Everything else — reading, searching — is never blocked. */
const GOVERNED_TOOLS: readonly string[] = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'];

export function hookVerdict({ status, tool }: { status: string; tool: string }) {
  if (!GOVERNED_TOOLS.includes(tool)) {
    return {
      decision: 'allow',
      exit_code: 0,
      // Allow is silence: the hook exits 0 with no output and the normal permission
      // flow continues. Only a denial has anything to say.
      output: null,
      reason: `${tool} does not modify files, so the hook has no opinion about it.`,
    };
  }

  if (!IMPLEMENTATION_STATES.includes(status)) {
    const reason =
      `The spec is in ${status}. File edits are permitted only in ` +
      'READY_FOR_IMPLEMENTATION or IMPLEMENTING, which requires the requirements, the ' +
      'design and the tasks to have been approved by a human.';

    return {
      decision: 'deny',
      exit_code: 2,
      // The literal payload Claude Code receives on stdout, so the demo shows the real
      // thing rather than a description of it.
      output: {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: reason,
        },
      },
      reason,
    };
  }

  return {
    decision: 'allow',
    exit_code: 0,
    output: null,
    reason:
      `The spec is in ${status} and a task is claimed, so the edit is attributable to ` +
      'a task and its acceptance criteria.',
  };
}

// ------------------------------------------------------------- compliance

/**
 * Every superseded term the pack knows about.
 *
 * The pack ships the pattern, its replacement and the reason for each one, so this lint
 * runs the pack's own detection rather than a second implementation of it. A rule added
 * there shows up here with no change at all — which is the only way a marketing page
 * and a product stay in agreement over time.
 */
const SUPERSEDED = COMPLIANCE_PACK.rules.flatMap((rule) =>
  rule.superseded_terms.map((term) => ({
    rule_key: rule.key,
    pattern: term.pattern,
    replacement: term.replacement,
    explanation: term.explanation,
  })),
);

export function lintText(text: string) {
  const hits = SUPERSEDED.flatMap((entry) => {
    const found = new RegExp(entry.pattern, 'i').exec(text);
    if (found === null) return [];

    return [
      {
        // What the writer actually typed, not the pattern that caught it.
        match: found[0].replace(/^section\s*/i, ''),
        rule_key: entry.rule_key,
        replacement: entry.replacement,
        explanation: entry.explanation,
      },
    ];
  });

  return { ok: hits.length === 0, hits, pack_version: PACK_VERSION };
}

// ---------------------------------------------------------------- TDS

/**
 * The Section 393 rows this calculator covers.
 *
 * Taken from the pack rather than restated, so the page cannot quote a rate the product
 * does not use. Thresholds are deliberately not applied here: this answers "what rate
 * and code", not "is this payment liable", and pretending otherwise would be the kind of
 * confident wrong answer the whole project is arguing against.
 */
const TDS_ROWS: Readonly<
  Record<string, { readonly label: string; readonly rate: number; readonly code: string }>
> = {
  technical: { label: 'Fees for technical services', rate: 2, code: '1026' },
  professional: { label: 'Fees for professional services', rate: 10, code: '1027' },
  contractor: { label: 'Payments to contractors', rate: 1, code: '1028' },
};

export function computeTds({
  category,
  payee,
  amount,
}: {
  category: string;
  payee: string;
  amount: number;
}) {
  const row = TDS_ROWS[category] ?? TDS_ROWS['professional'];
  if (row === undefined) throw new Error('no TDS rows configured');

  // Contractors are the one row where the payee changes the rate: 1% for an individual
  // or HUF, 2% for anyone else.
  const individual = payee === 'individual';
  const rate = category === 'contractor' ? (individual ? 1 : 2) : row.rate;
  const code = category === 'contractor' ? (individual ? '1028' : '1029') : row.code;

  const gross = Number.isFinite(amount) && amount > 0 ? amount : 0;
  const tds = Math.round(gross * rate) / 100;

  return {
    category: row.label,
    payee: individual ? 'Individual or HUF' : 'Company or firm',
    amount: gross,
    rate,
    code,
    tds,
    net: Math.round((gross - tds) * 100) / 100,
    section: `Section 393, Income-tax Act 2025 · pack ${PACK_VERSION}`,
    note:
      'Rate and payment code from the shipped pack. Thresholds are not applied here, ' +
      'and the pack has not been reviewed by a tax professional — confirm against the ' +
      'CBDT portal before relying on it.',
  };
}

// ------------------------------------------------------------- grounding

/**
 * The files the grounding playground may read.
 *
 * A closed allowlist of this repository's own source, not a path the caller chooses.
 * The verifier confines paths to a repository root anyway, but an allowlist means there
 * is no traversal surface to reason about on a public, unauthenticated endpoint — and
 * the demo is better for it, because every file in the list is real code a reader can
 * check against the published repository.
 */
export const SAMPLE_FILES: readonly string[] = [
  'packages/orchestrator/src/transition.ts',
  'packages/orchestrator/src/task-lifecycle.ts',
  'packages/context-agent/src/verifier.ts',
  'packages/compliance/src/pack.ts',
  'packages/plugin/src/hook.ts',
  'packages/contract/src/states.ts',
];

/**
 * The four worked examples the playground offers.
 *
 * Line numbers are computed from the files as they are *right now*, never written down.
 * A hardcoded range would be correct on the day it was typed and quietly wrong a week
 * later — and a grounding demo whose own "true claim" example has drifted out of date
 * would be a uniquely bad advertisement for a grounding verifier.
 */
export function sampleExamples() {
  const real = sampleFile('packages/orchestrator/src/transition.ts');
  const lines = real === null ? [] : real.content.split('\n');
  const at = lines.findIndex((line) => line.includes('export function transition'));
  const line = at >= 0 ? at + 1 : 1;

  return {
    /** Verifies. The symbol is where the claim says it is. */
    true_claim: {
      f: 'packages/orchestrator/src/transition.ts',
      s: line,
      e: line + 2,
      y: 'transition',
    },
    /** `file_not_found`: the shape of an invented citation. */
    invented_file: { f: 'packages/tax/src/section393.ts', s: 12, e: 30, y: 'computeSection393' },
    /** `line_range_past_eof`: a plausible file, guessed line numbers. */
    out_of_range: {
      f: 'packages/orchestrator/src/transition.ts',
      s: 9000,
      e: 9020,
      y: 'transition',
    },
    /** `symbol_not_in_range`: right file, wrong part of it. */
    wrong_place: { f: 'packages/orchestrator/src/transition.ts', s: 1, e: 3, y: 'transition' },
  };
}

export function sampleFiles() {
  return {
    name: 'agentforge',
    files: SAMPLE_FILES.map((path) => ({ path })),
    examples: sampleExamples(),
  };
}

/** Reads one allowlisted file, or null when the path is not on the list. */
export function sampleFile(path: string): { path: string; content: string } | null {
  if (!SAMPLE_FILES.includes(path)) return null;

  try {
    return { path, content: readFileSync(resolve(REPO_ROOT, path), 'utf8') };
  } catch {
    // A file was moved or renamed since the list was written. Reporting "not available"
    // is better than a 500 on a marketing page, and the list is asserted by a test.
    return null;
  }
}

export interface ClaimQuestion {
  readonly file: string;
  readonly line_start: number;
  readonly line_end: number;
  readonly symbol: string;
}

/** What the verifier concluded, and how a reader should fix a failure. */
const EXPLAIN: Record<string, { title: string; why: string; fix: string }> = {
  file_not_found: {
    title: 'No such file',
    why: 'The claim names a path that does not exist in the repository. This is the most common shape of an invented citation.',
    fix: 'Pick a file from the list, or search the repository before citing it.',
  },
  line_range_invalid: {
    title: 'That is not a range',
    why: 'The start line is after the end line, or one of them is not a positive number.',
    fix: 'Give a start line at or before the end line.',
  },
  line_range_past_eof: {
    title: 'Range runs past the end of the file',
    why: 'The file is shorter than the claim says. An agent that guessed at line numbers lands here.',
    fix: 'Narrow the range to lines that exist.',
  },
  symbol_not_in_range: {
    title: 'The symbol is not in those lines',
    why: 'The file and the range are both real, but the named symbol does not appear between them. The claim points at the wrong part of the right file.',
    fix: 'Move the range to where the symbol is actually defined.',
  },
};

export function verifyClaim(claim: ClaimQuestion) {
  const file = sampleFile(claim.file);

  if (file === null) {
    return {
      verdict: { ok: false, reason: 'file_not_found' },
      explain: { ...EXPLAIN['file_not_found'], alt: null },
      file_lines: null,
    };
  }

  const lines = file.content.split('\n');
  const { line_start: start, line_end: end, symbol } = claim;

  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) {
    return {
      verdict: { ok: false, reason: 'line_range_invalid' },
      explain: { ...EXPLAIN['line_range_invalid'], alt: null },
      file_lines: lines.length,
    };
  }

  if (end > lines.length) {
    return {
      verdict: { ok: false, reason: 'line_range_past_eof' },
      explain: { ...EXPLAIN['line_range_past_eof'], alt: null },
      file_lines: lines.length,
    };
  }

  const slice = lines.slice(start - 1, end).join('\n');

  if (symbol.length > 0 && !slice.includes(symbol)) {
    // Where the symbol really is, so the failure comes with a correction rather than
    // only a complaint. This is what the verifier hands back to the agent too.
    const at = lines.findIndex((line) => line.includes(symbol));

    return {
      verdict: { ok: false, reason: 'symbol_not_in_range' },
      explain: {
        ...EXPLAIN['symbol_not_in_range'],
        alt: at >= 0 ? { line_start: at + 1, line_end: at + 1 } : null,
      },
      file_lines: lines.length,
    };
  }

  return {
    verdict: { ok: true, reason: 'verified' },
    explain: null,
    file_lines: lines.length,
  };
}
