import { readFileSync, readdirSync, statSync } from 'node:fs';
import { z } from 'zod';
import { ValidationError } from '@agentforge/contract';
import type { Db } from '@agentforge/db';
import type { LoopTool } from '@agentforge/llm';
import { searchIndex } from './fts.ts';
import { resolveInside, toRepoRelative, type RepoRoot } from './paths.ts';
import { renderRepoMap, type RepoMap } from './repomap.ts';
import { search, type ScannedFile } from './scan.ts';
import { splitLines } from './verifier.ts';

/**
 * The agent's search tools.
 *
 * Every one of these runs against an **untrusted repository**, with arguments chosen by
 * a model. Two consequences shape the whole file:
 *
 * - **Confinement.** No path reaches the filesystem without `resolveInside`, which
 *   resolves symlinks and refuses anything outside the repository root. A model asking
 *   for a path above the root gets an error, not a file.
 * - **Arguments are validated, not trusted.** Each tool parses its input with Zod and
 *   returns a readable error for a bad argument. A malformed call is a normal event in a
 *   loop — the model should see what was wrong and fix it, not crash the run.
 *
 * Results are plain text rather than JSON. The model reads them, and text costs fewer
 * tokens than the equivalent JSON for the same content.
 */

/** Line budget for one `read_file` call, so a single read cannot eat the prompt. */
const MAX_READ_LINES = 400;
const MAX_SEARCH_MATCHES = 40;
const MAX_FTS_HITS = 25;
const MAX_DIR_ENTRIES = 200;

export interface ToolContext {
  readonly root: RepoRoot;
  readonly db: Db;
  readonly specId: string;
  /** Pre-computed inventory, so each search does not re-walk the repository. */
  readonly files: readonly ScannedFile[];
  readonly repoMap: RepoMap;
}

const RepoMapInput = z.strictObject({
  focus: z
    .array(z.string().min(1).max(100))
    .max(10)
    .optional()
    .describe('Identifiers or terms to bias the ranking towards.'),
});

const FtsInput = z.strictObject({
  query: z.string().min(1).max(200).describe('Symbol names or exact strings to look for.'),
});

const GrepInput = z.strictObject({
  pattern: z.string().min(1).max(500).describe('A regular expression.'),
  glob: z.string().min(1).max(200).optional().describe('Restrict to paths matching a glob.'),
  literal: z.boolean().optional().describe('Treat the pattern as a literal string.'),
});

const ReadInput = z.strictObject({
  path: z.string().min(1).max(1024).describe('Repo-relative path with forward slashes.'),
  line_start: z.number().int().positive().describe('1-based, inclusive.'),
  line_end: z.number().int().positive().describe('1-based, inclusive.'),
});

const ListInput = z.strictObject({
  path: z.string().max(1024).describe('Repo-relative directory. Empty string is the root.'),
});

/**
 * The tool definitions handed to the model.
 *
 * The descriptions are part of the prompt and are written as instructions to the model
 * rather than documentation for us: each says what the tool is good at and what it
 * costs, because that is the difference between three well-chosen searches and fifteen
 * speculative ones.
 */
export const CONTEXT_TOOLS: readonly LoopTool[] = [
  {
    name: 'repo_map',
    description:
      'Ranked list of the most central module-level symbols, optionally biased towards ' +
      'terms you supply. Start here: it shows the shape of the codebase before you read ' +
      'anything. Cheap.',
    inputSchema: z.toJSONSchema(RepoMapInput),
  },
  {
    name: 'fts_search',
    description:
      'Lexical index over symbol names, paths and doc comments. Strong on exact ' +
      'identifiers and error strings, weak on paraphrase: search for the identifier, ' +
      'not a description of it. Cheap.',
    inputSchema: z.toJSONSchema(FtsInput),
  },
  {
    name: 'grep',
    description:
      'Regular-expression search over file contents, with an optional path glob. Use ' +
      'when you need a pattern rather than a name, or to find all call sites of ' +
      'something you have already found.',
    inputSchema: z.toJSONSchema(GrepInput),
  },
  {
    name: 'read_file',
    description:
      'Reads an inclusive 1-based line range. Read the function, not the file: ranges ' +
      `are capped at ${String(MAX_READ_LINES)} lines, and a wide read spends budget you ` +
      'will want later. You must read a range before citing it.',
    inputSchema: z.toJSONSchema(ReadInput),
  },
  {
    name: 'list_dir',
    description:
      'Lists one directory, marking subdirectories. Use when a search finds nothing and ' +
      'you need to see what is actually there.',
    inputSchema: z.toJSONSchema(ListInput),
  },
];

/** Formats a Zod failure as something the model can act on. */
function describeInvalid(toolName: string, error: z.ZodError): string {
  const issues = error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
  return `Invalid arguments for ${toolName} — ${issues}. Correct them and call it again.`;
}

export function executeContextTool(ctx: ToolContext, name: string, rawInput: unknown): string {
  switch (name) {
    case 'repo_map':
      return runRepoMap(ctx, rawInput);
    case 'fts_search':
      return runFtsSearch(ctx, rawInput);
    case 'grep':
      return runGrep(ctx, rawInput);
    case 'read_file':
      return runRead(ctx, rawInput);
    case 'list_dir':
      return runList(ctx, rawInput);
    default:
      // Reachable only if the tool list and this switch disagree, which is our bug
      // rather than a model mistake, so it throws.
      throw new ValidationError(`unknown context tool "${name}"`, {
        known: CONTEXT_TOOLS.map((tool) => tool.name),
      });
  }
}

function runRepoMap(ctx: ToolContext, rawInput: unknown): string {
  const parsed = RepoMapInput.safeParse(rawInput);
  if (!parsed.success) return describeInvalid('repo_map', parsed.error);

  const focus = parsed.data.focus ?? [];
  if (focus.length === 0) return renderRepoMap(ctx.repoMap);

  // Re-ranked without re-parsing: this is a cheap re-weighting of entries we already
  // have, and re-running tree-sitter per tool call would dominate the run.
  const lowered = focus.map((term) => term.toLowerCase());
  const reranked = ctx.repoMap.entries
    .map((entry) => {
      const hit = lowered.some(
        (term) =>
          entry.name.toLowerCase().includes(term) || entry.file.toLowerCase().includes(term),
      );
      return { entry, score: entry.rank * (hit ? 10 : 1) };
    })
    .sort((a, b) => b.score - a.score)
    .map((row) => row.entry);

  return renderRepoMap({ ...ctx.repoMap, entries: reranked });
}

function runFtsSearch(ctx: ToolContext, rawInput: unknown): string {
  const parsed = FtsInput.safeParse(rawInput);
  if (!parsed.success) return describeInvalid('fts_search', parsed.error);

  const hits = searchIndex(ctx.db, ctx.specId, parsed.data.query, MAX_FTS_HITS);
  if (hits.length === 0) {
    return (
      `No index hits for "${parsed.data.query}". ` +
      'Try a shorter stem, a related identifier, or grep.'
    );
  }

  return hits
    .map(
      (hit) => `${hit.path} — ${hit.kind} ${hit.symbol}\n    ${hit.snippet.replace(/\s+/g, ' ')}`,
    )
    .join('\n');
}

function runGrep(ctx: ToolContext, rawInput: unknown): string {
  const parsed = GrepInput.safeParse(rawInput);
  if (!parsed.success) return describeInvalid('grep', parsed.error);

  const { pattern, glob, literal } = parsed.data;
  let matches: readonly { path: string; line: number; text: string }[];
  try {
    matches = search(ctx.root, pattern, {
      ...(glob === undefined ? {} : { glob }),
      ...(literal === undefined ? {} : { literal }),
      maxMatches: MAX_SEARCH_MATCHES,
      files: ctx.files,
    });
  } catch (error) {
    // An invalid regular expression is an expected model mistake. Hand back the engine's
    // own message so the next attempt can be correct.
    return `grep failed: ${error instanceof Error ? error.message : String(error)}`;
  }

  if (matches.length === 0) {
    const where = glob === undefined ? '' : ` in ${glob}`;
    return `No matches for ${pattern}${where}.`;
  }

  const header =
    matches.length === MAX_SEARCH_MATCHES
      ? `First ${String(MAX_SEARCH_MATCHES)} matches (there may be more; narrow the pattern):\n`
      : '';

  return (
    header +
    matches.map((match) => `${match.path}:${String(match.line)}: ${match.text.trim()}`).join('\n')
  );
}

function runRead(ctx: ToolContext, rawInput: unknown): string {
  const parsed = ReadInput.safeParse(rawInput);
  if (!parsed.success) return describeInvalid('read_file', parsed.error);

  const { path, line_start: start, line_end: end } = parsed.data;
  if (end < start) {
    return `line_end (${String(end)}) is before line_start (${String(start)}).`;
  }

  let absolute: string;
  try {
    absolute = resolveInside(ctx.root, path);
  } catch (error) {
    // Confinement refusals land here, including symlinks pointing out of the repository.
    return `Cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`;
  }

  let isDirectory: boolean;
  try {
    isDirectory = statSync(absolute).isDirectory();
  } catch {
    return `${path} does not exist.`;
  }
  if (isDirectory) return `${path} is a directory. Use list_dir for it.`;

  let content: string;
  try {
    content = readFileSync(absolute, 'utf8');
  } catch (error) {
    return `${path} could not be read: ${error instanceof Error ? error.message : String(error)}`;
  }

  // The same line splitter the verifier uses, so what the agent reads and what gets
  // checked agree on where a line boundary is — CRLF included.
  const lines = splitLines(content);
  if (start > lines.length) {
    return `${path} has ${String(lines.length)} lines, so line ${String(start)} is past the end.`;
  }

  const capped = Math.min(end, start + MAX_READ_LINES - 1, lines.length);
  const body = lines
    .slice(start - 1, capped)
    .map((line, offset) => `${String(start + offset)}\t${line}`)
    .join('\n');

  const note =
    capped < end
      ? `\n...[stopped at line ${String(capped)}; reads are capped at ${String(MAX_READ_LINES)} lines]`
      : '';

  return `${path} lines ${String(start)}-${String(capped)} of ${String(lines.length)}:\n${body}${note}`;
}

function runList(ctx: ToolContext, rawInput: unknown): string {
  const parsed = ListInput.safeParse(rawInput);
  if (!parsed.success) return describeInvalid('list_dir', parsed.error);

  const target = parsed.data.path.trim();
  let absolute: string;
  try {
    absolute = target === '' || target === '.' ? ctx.root.real : resolveInside(ctx.root, target);
  } catch (error) {
    return `Cannot list ${target}: ${error instanceof Error ? error.message : String(error)}`;
  }

  let entries: readonly { name: string; isDirectory: () => boolean }[];
  try {
    entries = readdirSync(absolute, { withFileTypes: true });
  } catch (error) {
    return `Cannot list ${target}: ${error instanceof Error ? error.message : String(error)}`;
  }

  const label = target === '' ? '(root)' : target;
  if (entries.length === 0) return `${label} is empty.`;

  const shown = entries.slice(0, MAX_DIR_ENTRIES).map((entry) => {
    const relative = toRepoRelative(ctx.root, `${absolute}/${entry.name}`);
    return entry.isDirectory() ? `${relative}/` : relative;
  });

  const note =
    entries.length > MAX_DIR_ENTRIES
      ? `\n...[${String(entries.length - MAX_DIR_ENTRIES)} more entries]`
      : '';

  return shown.sort().join('\n') + note;
}
