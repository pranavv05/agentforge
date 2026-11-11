import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Language, Parser, type Node } from 'web-tree-sitter';
import Graph from 'graphology';
import pagerank from 'graphology-metrics/centrality/pagerank';
import { resolveInside, type RepoRoot } from './paths.ts';
import { languageFor, type ScannedFile, type SupportedLanguage } from './scan.ts';

/**
 * The repository map.
 *
 * A ranked table of contents, built with tree-sitter and personalised PageRank, in the
 * style Aider established. It exists because of a cost argument: an agent that starts
 * from a ranked list of the repository's most connected symbols needs far fewer search
 * calls than one that starts from nothing, and search calls are the expensive part.
 *
 * The ranking question is "which symbols matter here", and the answer is graph-shaped:
 * a definition referenced from many files is more central than one referenced from one.
 * PageRank over a definition/reference graph answers exactly that, and *personalising*
 * it on the feature's own terms answers "which symbols matter to *this* feature".
 *
 * Grammars are loaded lazily and per language, through a registry: a repository in a
 * language we cannot parse still gets a lexical index, it simply gets no repo map. A
 * missing grammar degrades the output rather than failing the scan.
 */

const require = createRequire(import.meta.url);

/** Resolved once; the package ships the `.wasm` files in `out/`. */
const WASM_DIR = require
  .resolve('tree-sitter-wasms/package.json')
  .replace(/package\.json$/, 'out/');

const GRAMMAR_FILE: Readonly<Record<SupportedLanguage, string>> = {
  typescript: 'tree-sitter-typescript.wasm',
  tsx: 'tree-sitter-tsx.wasm',
  python: 'tree-sitter-python.wasm',
  java: 'tree-sitter-java.wasm',
  go: 'tree-sitter-go.wasm',
};

/**
 * Node types that introduce a name, per language.
 *
 * Tree-sitter grammars differ, so this is a lookup rather than one clever rule. A node
 * type absent here simply contributes references, not definitions — which is the safe
 * direction to be wrong in: an under-recognised definition loses a little ranking
 * signal, whereas a false definition would pollute the map.
 */
const DEFINITION_TYPES: Readonly<Record<SupportedLanguage, readonly string[]>> = {
  typescript: [
    'function_declaration',
    'class_declaration',
    'interface_declaration',
    'type_alias_declaration',
    'enum_declaration',
    'method_definition',
    'variable_declarator',
    'public_field_definition',
  ],
  tsx: [
    'function_declaration',
    'class_declaration',
    'interface_declaration',
    'type_alias_declaration',
    'enum_declaration',
    'method_definition',
    'variable_declarator',
    'public_field_definition',
  ],
  python: ['function_definition', 'class_definition'],
  java: [
    'class_declaration',
    'interface_declaration',
    'method_declaration',
    'enum_declaration',
    'record_declaration',
  ],
  go: ['function_declaration', 'method_declaration', 'type_declaration', 'type_spec'],
};

/**
 * Node types that introduce a new scope for the purposes of "is this module-level API".
 *
 * Classes are deliberately absent: a method is part of its class's API, so it should
 * rank. A `const` inside a function body is a local and should not.
 */
const FUNCTION_SCOPE_TYPES: ReadonlySet<string> = new Set([
  'function_declaration',
  'function_definition',
  'function_expression',
  'function',
  'arrow_function',
  'method_definition',
  'method_declaration',
  'generator_function_declaration',
  'constructor_declaration',
]);

/**
 * Whether a definition is module-level API rather than a local.
 *
 * This filter is the difference between a useful repo map and a useless one. Without
 * it, every `const map = ...` inside a function body becomes a "definition", and since
 * symbols resolve by name, fifty local variables called `map` collapse into one node
 * with an enormous rank — which is exactly what happened on the first real repository
 * this was run against.
 */
function isModuleLevel(node: Node): boolean {
  let current = node.parent;
  while (current !== null) {
    if (FUNCTION_SCOPE_TYPES.has(current.type)) return false;
    current = current.parent;
  }
  return true;
}

/**
 * Names too generic to be useful signal.
 *
 * Short identifiers are overwhelmingly locals and loop counters, and because symbols
 * resolve by name a single-letter name matches across the entire repository.
 */
const MIN_SYMBOL_LENGTH = 3;

/**
 * Paths whose definitions are excluded from the map.
 *
 * Test helpers and fixtures are real code, but an agent orienting itself in a codebase
 * wants the API under test, not the scaffolding around it. They still contribute
 * *references*, which is the correct asymmetry: a symbol exercised by many tests is
 * genuinely important.
 */
const TEST_PATH = new RegExp(
  [
    // A path segment that is a test or fixture directory.
    '(^|/)(test|tests|__tests__|spec|fixture|fixtures)(/|$)',
    // Or a file named *.test.ts / *.spec.py and so on.
    '\\.(test|spec)\\.[a-z]+$',
  ].join('|'),
  'i',
);

function isTestPath(path: string): boolean {
  return TEST_PATH.test(path);
}

/**
 * Identifier node types counted as *references*.
 *
 * `property_identifier` and `field_identifier` are deliberately excluded. Symbols here
 * resolve by name, and `response.status` cannot be attributed to a method named
 * `status` without real type resolution — on the first real repository, that single
 * false edge made an error-class getter look like one of the most central symbols in the
 * codebase. Losing some method-level ranking is a fair price for a trustworthy top of
 * the list.
 */
const REFERENCE_TYPES: readonly string[] = ['identifier', 'type_identifier'];

/** Identifier node types that can *name* a definition, including class members. */
const IDENTIFIER_TYPES: readonly string[] = [
  'identifier',
  'type_identifier',
  'property_identifier',
  'field_identifier',
  'constructor',
];

export interface SymbolDefinition {
  readonly name: string;
  readonly kind: string;
  /** Repo-relative path. */
  readonly file: string;
  /** 1-based, inclusive. */
  readonly lineStart: number;
  readonly lineEnd: number;
}

export interface RepoMapEntry extends SymbolDefinition {
  /** PageRank score, higher is more central. */
  readonly rank: number;
  /** How many distinct files reference this symbol. */
  readonly referencedByFiles: number;
}

export interface RepoMap {
  readonly entries: readonly RepoMapEntry[];
  readonly definitions: readonly SymbolDefinition[];
  readonly stats: {
    readonly filesParsed: number;
    readonly filesSkipped: number;
    readonly definitionCount: number;
    readonly referenceCount: number;
    /** Languages we had no grammar for, so could not parse structurally. */
    readonly unparsedLanguages: readonly string[];
  };
}

let initialised = false;
const grammars = new Map<SupportedLanguage, Language | null>();

/**
 * Initialises the tree-sitter runtime.
 *
 * Must happen before a `Parser` is constructed, not merely before one is used — the
 * constructor itself throws otherwise. Idempotent, so every entry point can call it.
 */
async function ensureInitialised(): Promise<void> {
  if (initialised) return;
  await Parser.init();
  initialised = true;
}

/** Loads a grammar, caching both successes and failures. */
async function grammarFor(language: SupportedLanguage): Promise<Language | null> {
  await ensureInitialised();

  const cached = grammars.get(language);
  if (cached !== undefined) return cached;

  try {
    // `turbopackIgnore` because the grammar is chosen by language at runtime. The
    // directory is fixed and the filenames come from a closed table, so this is not
    // open-ended — but it is not a literal either, and without the annotation the
    // bundler traces the whole project into the server bundle.
    const loaded = await Language.load(
      readFileSync(/* turbopackIgnore: true */ `${WASM_DIR}${GRAMMAR_FILE[language]}`),
    );
    grammars.set(language, loaded);
    return loaded;
  } catch {
    // Caching the failure keeps a missing grammar from being retried per file.
    grammars.set(language, null);
    return null;
  }
}

/** The identifier that names a definition node, if it has one. */
function definitionName(node: Node): Node | null {
  // Most grammars expose the name as a `name` field.
  const named = node.childForFieldName('name');
  if (named !== null) return named;

  // `variable_declarator` and Go's `type_spec` use the first identifier child.
  for (let i = 0; i < node.namedChildCount; i += 1) {
    const child = node.namedChild(i);
    if (child !== null && IDENTIFIER_TYPES.includes(child.type)) return child;
  }
  return null;
}

interface FileAnalysis {
  readonly definitions: readonly SymbolDefinition[];
  /** Distinct identifier names referenced in this file. */
  readonly references: ReadonlySet<string>;
}

/** Walks one file's syntax tree, collecting definitions and referenced names. */
function analyseTree(rootNode: Node, language: SupportedLanguage, file: string): FileAnalysis {
  const definitionTypes = new Set(DEFINITION_TYPES[language]);
  const definitions: SymbolDefinition[] = [];
  const references = new Set<string>();
  const definedHere = new Set<string>();

  // Iterative walk: a recursive one overflows the stack on a deeply nested file, and
  // minified or generated sources are exactly that.
  const stack: Node[] = [rootNode];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === undefined) continue;

    if (definitionTypes.has(node.type)) {
      const nameNode = definitionName(node);
      const name = nameNode?.text ?? '';

      if (
        nameNode !== null &&
        name.length >= MIN_SYMBOL_LENGTH &&
        // A local is not API, and treating it as one wrecks the ranking.
        isModuleLevel(node)
      ) {
        definitions.push({
          name,
          kind: node.type,
          file,
          lineStart: node.startPosition.row + 1,
          lineEnd: node.endPosition.row + 1,
        });
        definedHere.add(name);
      }
    }

    if (REFERENCE_TYPES.includes(node.type) && node.text.length >= MIN_SYMBOL_LENGTH) {
      references.add(node.text);
    }

    for (let i = 0; i < node.childCount; i += 1) {
      const child = node.child(i);
      if (child !== null) stack.push(child);
    }
  }

  // A file referencing its own definitions is not a cross-file signal, and counting it
  // would make every self-contained module look central.
  for (const name of definedHere) references.delete(name);

  return { definitions, references };
}

export interface RepoMapOptions {
  /**
   * Terms from the feature request, used to personalise the ranking.
   *
   * This is what turns a generic "most central symbols" list into "most central symbols
   * *for this feature*". Without it the map is the same for every request and much less
   * useful.
   */
  readonly focus?: readonly string[];
  /** Maximum entries to return. */
  readonly limit?: number;
}

/**
 * Builds the map.
 *
 * Files that fail to parse are skipped and counted, never fatal: one generated or
 * truncated file must not deny the agent a map of the rest of the repository.
 */
export async function buildRepoMap(
  root: RepoRoot,
  files: readonly ScannedFile[],
  options: RepoMapOptions = {},
): Promise<RepoMap> {
  const definitions: SymbolDefinition[] = [];
  /** file -> names it references */
  const fileReferences = new Map<string, ReadonlySet<string>>();
  const unparsedLanguages = new Set<string>();

  let filesParsed = 0;
  let filesSkipped = 0;
  let referenceCount = 0;

  // Before the constructor, not just before first use: `new Parser()` throws if the
  // runtime has not been initialised.
  await ensureInitialised();
  const parser = new Parser();

  for (const file of files) {
    const language = file.language ?? languageFor(file.path);
    if (language === null) continue;

    const grammar = await grammarFor(language);
    if (grammar === null) {
      unparsedLanguages.add(language);
      filesSkipped += 1;
      continue;
    }

    let source: string;
    try {
      source = readFileSync(resolveInside(root, file.path), 'utf8');
    } catch {
      filesSkipped += 1;
      continue;
    }

    let analysis: FileAnalysis;
    try {
      parser.setLanguage(grammar);
      const tree = parser.parse(source);
      if (tree === null) {
        filesSkipped += 1;
        continue;
      }
      analysis = analyseTree(tree.rootNode, language, file.path);
      tree.delete();
    } catch {
      filesSkipped += 1;
      continue;
    }

    // Test files contribute references but not definitions: a symbol exercised by many
    // tests is genuinely important, while a test helper is scaffolding an agent does not
    // need to be pointed at.
    if (!isTestPath(file.path)) {
      definitions.push(...analysis.definitions);
    }
    fileReferences.set(file.path, analysis.references);
    referenceCount += analysis.references.size;
    filesParsed += 1;
  }

  const entries = rank(definitions, fileReferences, options);

  return {
    entries,
    definitions,
    stats: {
      filesParsed,
      filesSkipped,
      definitionCount: definitions.length,
      referenceCount,
      unparsedLanguages: [...unparsedLanguages].sort(),
    },
  };
}

/**
 * Ranks definitions with personalised PageRank over a file/symbol graph.
 *
 * The graph has a node per file and per defined symbol. An edge runs from a file to
 * each symbol it references, and from a symbol to the file defining it, so importance
 * flows from users to definitions and back out through the defining file's own
 * references — which is what makes a widely used utility rank above a leaf.
 */
function rank(
  definitions: readonly SymbolDefinition[],
  fileReferences: ReadonlyMap<string, ReadonlySet<string>>,
  options: RepoMapOptions,
): readonly RepoMapEntry[] {
  if (definitions.length === 0) return [];

  const graph = new Graph({ type: 'directed', allowSelfLoops: false });

  const symbolNode = (name: string): string => `sym:${name}`;
  const fileNode = (path: string): string => `file:${path}`;

  // How many distinct files define each name. A reference to a name defined in several
  // places cannot be attributed to one of them without real type resolution, so beyond a
  // small threshold the edge is noise rather than signal — which is how generic
  // module-level names like `path` and `map` came to outrank the actual API.
  const filesDefiningName = new Map<string, Set<string>>();
  for (const definition of definitions) {
    const seen = filesDefiningName.get(definition.name) ?? new Set<string>();
    seen.add(definition.file);
    filesDefiningName.set(definition.name, seen);
  }

  /** Names defined in few enough places that a reference is plausibly resolvable. */
  const MAX_DEFINING_FILES = 2;
  const resolvableNames = new Set(
    [...filesDefiningName.entries()]
      .filter(([, files]) => files.size <= MAX_DEFINING_FILES)
      .map(([name]) => name),
  );

  const definedNames = resolvableNames;
  const definingFiles = new Map<string, string[]>();

  for (const definition of definitions) {
    if (!resolvableNames.has(definition.name)) continue;

    const sym = symbolNode(definition.name);
    if (!graph.hasNode(sym)) graph.addNode(sym);

    const node = fileNode(definition.file);
    if (!graph.hasNode(node)) graph.addNode(node);

    definingFiles.set(definition.name, [
      ...(definingFiles.get(definition.name) ?? []),
      definition.file,
    ]);

    // symbol -> defining file
    if (!graph.hasEdge(sym, node)) graph.addDirectedEdge(sym, node);
  }

  const referencingFiles = new Map<string, Set<string>>();

  for (const [path, references] of fileReferences) {
    const from = fileNode(path);
    if (!graph.hasNode(from)) graph.addNode(from);

    for (const name of references) {
      // Only edges to symbols actually defined in this repository; an import from a
      // dependency is not a signal about this codebase's own structure.
      if (!definedNames.has(name)) continue;

      const to = symbolNode(name);
      if (!graph.hasNode(to)) graph.addNode(to);
      if (!graph.hasEdge(from, to)) graph.addDirectedEdge(from, to);

      const seen = referencingFiles.get(name) ?? new Set<string>();
      seen.add(path);
      referencingFiles.set(name, seen);
    }
  }

  // Personalisation: weight the focus terms so ranking answers "central to this
  // feature" rather than "central in general".
  let scores: Record<string, number>;
  try {
    scores = pagerank(graph, { getEdgeWeight: null, alpha: 0.85, tolerance: 1e-6 });
  } catch {
    // A degenerate graph should not deny the agent a map; the reference-count tiebreak
    // in the sort below still produces a useful ordering.
    scores = {};
  }

  // Focus terms are applied as a multiplier on the computed scores rather than as a
  // personalisation vector, because graphology's pagerank does not take one. Being
  // explicit about that: this is a boost over the global ranking, not true personalised
  // PageRank. The global signal stays the base, so a focus term that matches nothing
  // leaves the ordering untouched instead of flattening it.
  const focus = (options.focus ?? []).map((t) => t.toLowerCase()).filter((t) => t.length > 2);
  if (focus.length > 0) {
    const FOCUS_BOOST = 4;
    for (const name of definedNames) {
      const lower = name.toLowerCase();
      if (focus.some((term) => lower.includes(term) || term.includes(lower))) {
        const node = symbolNode(name);
        scores[node] = (scores[node] ?? 0) * FOCUS_BOOST;
      }
    }
  }

  const limit = options.limit ?? 100;

  return definitions
    .map((definition) => ({
      ...definition,
      rank: scores[symbolNode(definition.name)] ?? 0,
      referencedByFiles: referencingFiles.get(definition.name)?.size ?? 0,
    }))
    .sort(
      (a, b) =>
        b.rank - a.rank ||
        b.referencedByFiles - a.referencedByFiles ||
        a.file.localeCompare(b.file, 'en') ||
        a.lineStart - b.lineStart,
    )
    .slice(0, limit);
}

/**
 * Renders the map for a prompt, under a token budget.
 *
 * Aider's default is around 1,024 tokens, and the same reasoning applies: the map is
 * orientation, not content. Characters are converted at roughly four per token, with
 * the same 30% margin the cost estimator uses, so the budget is not quietly overshot.
 */
export function renderRepoMap(map: RepoMap, tokenBudget = 1_500): string {
  if (map.entries.length === 0) return '';

  const charBudget = Math.floor((tokenBudget * 4) / 1.3);
  const header = ['## Repository map', '', 'Most connected symbols, ranked:', ''];

  const lines: string[] = [];
  let used = header.join('\n').length;

  // Grouped by file so the shape of the codebase is visible, not just a symbol list.
  const byFile = new Map<string, RepoMapEntry[]>();
  for (const entry of map.entries) {
    byFile.set(entry.file, [...(byFile.get(entry.file) ?? []), entry]);
  }

  for (const [file, entries] of byFile) {
    const block = [
      `### \`${file}\``,
      ...entries.map(
        (e) =>
          `- \`${e.name}\` (${e.kind}, lines ${String(e.lineStart)}-${String(e.lineEnd)})` +
          (e.referencedByFiles > 0
            ? `, referenced from ${String(e.referencedByFiles)} file(s)`
            : ''),
      ),
      '',
    ].join('\n');

    if (used + block.length > charBudget) break;
    lines.push(block);
    used += block.length;
  }

  return [...header, ...lines].join('\n').trimEnd();
}
