import { PathEscapesRootError, ValidationError } from '@agentforge/contract';
import { lstatSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

/**
 * Path confinement.
 *
 * The Context Agent reads repositories it did not write, and the paths it reads come
 * from a model. Both are untrusted. Every file access in this package goes through
 * `resolveInside`, which is the only place that turns an agent-supplied string into a
 * path on disk.
 *
 * Three escapes are closed:
 *
 * - **Traversal** — `../../etc/passwd`, and the absolute-path form.
 * - **Symlinks** — a link inside the repo pointing outside it. Containment is checked
 *   on the *real* path, after resolution, not on the string.
 * - **Case** — on Windows, `C:\Repo` and `c:\repo` are the same directory, so a
 *   case-sensitive string comparison would be fooled.
 *
 * The check is deliberately a hard failure rather than a sanitisation. Silently
 * rewriting a path an agent asked for would make its citations describe a file it never
 * read, which is precisely the thing the grounding verifier exists to detect.
 */

/** Windows treats paths case-insensitively; POSIX does not. */
const CASE_INSENSITIVE = process.platform === 'win32';

/** A validated repository root. Branded so an arbitrary string cannot be passed as one. */
export interface RepoRoot {
  /** The real, absolute path, with symlinks resolved. */
  readonly real: string;
  readonly __brand: 'RepoRoot';
}

function normaliseForCompare(path: string): string {
  return CASE_INSENSITIVE ? path.toLowerCase() : path;
}

/**
 * Validates a repository root once, up front.
 *
 * Resolving symlinks here means every later containment check compares real path
 * against real path, so a root that is itself a symlink does not make everything inside
 * it look like an escape.
 */
export function createRepoRoot(path: string): RepoRoot {
  if (path.length === 0) {
    throw new ValidationError('a repository root must not be empty');
  }

  // `turbopackIgnore` because the path is a repository the caller chose, so it is
  // dynamic by design — that is the entire purpose of this function. Without the
  // annotation the bundler concludes it must trace the whole project into the server
  // bundle. Nothing is read here: the path is only resolved, and every later access
  // goes through the containment check below.
  const absolute = isAbsolute(path)
    ? path
    : resolve(/* turbopackIgnore: true */ process.cwd(), path);

  let real: string;
  try {
    real = realpathSync(absolute);
  } catch (cause) {
    throw new ValidationError(`repository root does not exist: ${absolute}`, {
      path: absolute,
      cause: cause instanceof Error ? cause.message : String(cause),
    });
  }

  if (!statSync(real).isDirectory()) {
    throw new ValidationError(`repository root is not a directory: ${real}`, { path: real });
  }

  return { real, __brand: 'RepoRoot' };
}

/** Whether `candidate` is the root itself or sits beneath it. */
function isContained(root: string, candidate: string): boolean {
  const a = normaliseForCompare(root);
  const b = normaliseForCompare(candidate);

  if (a === b) return true;

  const rel = relative(a, b);
  // `relative` returns '' for the same path, a '..'-prefixed path for an escape, and an
  // absolute path when the two are on different Windows drives.
  return rel.length > 0 && !rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel);
}

export interface ResolveOptions {
  /** Require the path to exist. Defaults to true. */
  readonly mustExist?: boolean;
}

/**
 * Turns a repo-relative path into an absolute path inside the root, or throws.
 *
 * Rejects absolute inputs outright: an agent citing `/etc/passwd` is not describing the
 * repository under analysis, so there is no sensible interpretation to recover.
 */
export function resolveInside(
  root: RepoRoot,
  repoRelativePath: string,
  options: ResolveOptions = {},
): string {
  const mustExist = options.mustExist ?? true;

  if (repoRelativePath.length === 0) {
    throw new ValidationError('a path must not be empty');
  }
  if (repoRelativePath.includes('\0')) {
    // A NUL byte truncates the path in some syscalls, so it is a classic bypass.
    throw new ValidationError('a path must not contain NUL bytes');
  }
  if (isAbsolute(repoRelativePath) || /^[A-Za-z]:/.test(repoRelativePath)) {
    throw new PathEscapesRootError(
      `"${repoRelativePath}" is absolute; only repository-relative paths may be read`,
      { path: repoRelativePath, root: root.real },
    );
  }

  const joined = resolve(root.real, repoRelativePath);

  // Lexical check first: it catches traversal without touching the filesystem, so a
  // hostile path is rejected before any syscall is made with it.
  if (!isContained(root.real, joined)) {
    throw new PathEscapesRootError(`"${repoRelativePath}" resolves outside the repository root`, {
      path: repoRelativePath,
      resolved: joined,
      root: root.real,
    });
  }

  if (!mustExist) return joined;

  // Then the real check, which closes symlink escapes: the lexical form can sit inside
  // the root while the link target does not.
  let real: string;
  try {
    real = realpathSync(joined);
  } catch (cause) {
    throw new ValidationError(`path does not exist: ${repoRelativePath}`, {
      path: repoRelativePath,
      cause: cause instanceof Error ? cause.message : String(cause),
    });
  }

  if (!isContained(root.real, real)) {
    throw new PathEscapesRootError(
      `"${repoRelativePath}" is a link that resolves outside the repository root`,
      { path: repoRelativePath, resolved: real, root: root.real },
    );
  }

  return real;
}

/** The repo-relative, forward-slashed form of an absolute path inside the root. */
export function toRepoRelative(root: RepoRoot, absolutePath: string): string {
  const rel = relative(root.real, absolutePath);
  if (rel.length === 0) return '.';
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new PathEscapesRootError(`${absolutePath} is not inside the repository root`, {
      path: absolutePath,
      root: root.real,
    });
  }
  // Forward slashes everywhere: paths cross into JSON, prompts and citations, and a
  // backslash would make the same file look like two different ones across platforms.
  return rel.split(sep).join('/');
}

/**
 * Whether a path is a symlink.
 *
 * Used by the scanner to skip links entirely rather than follow them: a link that
 * resolves inside the root is harmless but would be indexed twice, and one that
 * resolves outside must not be read at all.
 */
export function isSymlink(absolutePath: string): boolean {
  try {
    return lstatSync(absolutePath).isSymbolicLink();
  } catch {
    return false;
  }
}

/** Joins repo-relative segments into a repo-relative path, forward-slashed. */
export function repoJoin(...segments: readonly string[]): string {
  return join(...segments)
    .split(sep)
    .join('/');
}
