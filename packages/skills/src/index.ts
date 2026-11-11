import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

/**
 * `@agentforge/skills` — agent prompts as SKILL.md files.
 *
 * Every agent's instructions live in a SKILL.md file in the open Agent Skills format,
 * for one reason: the same text is loaded as the system prompt by our Messages API
 * calls *and* installed into Claude Code as a skill for the implementation phase. Two
 * copies of a prompt drift within a day, and a drifted prompt is the kind of bug that
 * produces plausible-looking wrong output rather than an error.
 *
 * The loader is deliberately strict and deterministic: no clock, no environment, no
 * interpolation. A prompt that varied per call would destroy the cache prefix.
 */

const SKILLS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The names of the skills this package ships. */
export const SKILL_NAMES = ['sdd-context', 'sdd-requirements', 'sdd-design', 'sdd-tasks'] as const;

export type SkillName = (typeof SKILL_NAMES)[number];

/** Frontmatter required of every SKILL.md. Matches the Agent Skills format. */
export const SkillFrontmatterSchema = z.strictObject({
  name: z.string().min(1).max(64),
  description: z.string().min(1).max(1024),
});

export type SkillFrontmatter = z.infer<typeof SkillFrontmatterSchema>;

export interface Skill {
  readonly name: SkillName;
  readonly frontmatter: SkillFrontmatter;
  /** The markdown body, with frontmatter removed. This is the system prompt. */
  readonly instructions: string;
}

/**
 * Parses YAML frontmatter.
 *
 * Deliberately a small, strict reader rather than a YAML dependency: the frontmatter
 * we use is two scalar fields, and a strict parser means a malformed header fails at
 * load instead of silently yielding an empty description.
 */
function parseFrontmatter(raw: string, file: string): { meta: SkillFrontmatter; body: string } {
  const normalised = raw.replace(/\r\n/g, '\n');

  if (!normalised.startsWith('---\n')) {
    throw new Error(`${file} must begin with a '---' frontmatter block`);
  }

  const end = normalised.indexOf('\n---\n', 3);
  if (end === -1) {
    throw new Error(`${file} has an unterminated frontmatter block`);
  }

  const header = normalised.slice(4, end);
  const body = normalised.slice(end + 5).trim();

  const fields: Record<string, string> = {};
  for (const line of header.split('\n')) {
    if (line.trim().length === 0) continue;

    const separator = line.indexOf(':');
    if (separator === -1) {
      throw new Error(`${file} frontmatter line is not 'key: value': ${line}`);
    }

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    // Allow quoted values so a description may contain a colon.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    fields[key] = value;
  }

  const parsed = SkillFrontmatterSchema.safeParse(fields);
  if (!parsed.success) {
    throw new Error(
      `${file} frontmatter is invalid: ${parsed.error.issues
        .map((i) => `${i.path.join('.')} ${i.message}`)
        .join('; ')}`,
    );
  }

  if (body.length === 0) {
    throw new Error(`${file} has frontmatter but no instructions`);
  }

  return { meta: parsed.data, body };
}

const cache = new Map<SkillName, Skill>();

/**
 * Loads a skill.
 *
 * Cached after first read: the file is immutable at runtime, and re-reading it per
 * request would be wasted I/O on a hot path.
 */
export function loadSkill(name: SkillName): Skill {
  const cached = cache.get(name);
  if (cached !== undefined) return cached;

  const file = join(SKILLS_DIR, name, 'SKILL.md');
  if (!existsSync(file)) {
    throw new Error(`skill "${name}" has no SKILL.md at ${file}`);
  }

  const { meta, body } = parseFrontmatter(readFileSync(file, 'utf8'), file);

  if (meta.name !== name) {
    throw new Error(
      `skill directory "${name}" declares frontmatter name "${meta.name}"; they must match ` +
        'so a skill cannot be loaded under the wrong identity',
    );
  }

  const skill: Skill = { name, frontmatter: meta, instructions: body };
  cache.set(name, skill);
  return skill;
}

/** The system-prompt text for a skill. */
export function skillInstructions(name: SkillName): string {
  return loadSkill(name).instructions;
}

/** Every shipped skill. Used by the prompt tests and by the plugin packager. */
export function loadAllSkills(): readonly Skill[] {
  return SKILL_NAMES.map(loadSkill);
}

/**
 * Skill directories present on disk.
 *
 * Compared against `SKILL_NAMES` by the tests, so a skill added as a file but not
 * registered — or registered but not written — fails the build.
 */
export function discoverSkillDirectories(): readonly string[] {
  return readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(SKILLS_DIR, entry.name, 'SKILL.md')))
    .map((entry) => entry.name)
    .sort();
}

/** Clears the cache. Tests use this after writing a temporary skill. */
export function clearSkillCache(): void {
  cache.clear();
}
