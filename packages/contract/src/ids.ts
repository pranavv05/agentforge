import { z } from 'zod';

/**
 * Stable identifier formats.
 *
 * Traceability is only as good as its keys: a requirement is cited by a design
 * section, which is cited by a task, which is cited by a test. If those ids drift
 * between a model run and a markdown render the whole trace matrix silently rots,
 * so the formats are pinned here and asserted by golden-file tests on the renderers.
 */

const pattern = (prefix: string): RegExp => new RegExp(`^${prefix}-[0-9]{3,4}$`);

export const RequirementIdSchema = z
  .string()
  .regex(pattern('REQ'), 'requirement id must look like REQ-001');

export const AcceptanceCriterionIdSchema = z
  .string()
  .regex(pattern('AC'), 'acceptance criterion id must look like AC-001');

export const DesignSectionIdSchema = z
  .string()
  .regex(pattern('DES'), 'design section id must look like DES-001');

export const DecisionIdSchema = z
  .string()
  .regex(pattern('ADR'), 'decision id must look like ADR-001');

export const TaskIdSchema = z.string().regex(pattern('TASK'), 'task id must look like TASK-001');

export const EvidenceIdSchema = z
  .string()
  .regex(pattern('EV'), 'evidence id must look like EV-001');

/**
 * Compliance rule keys are human-authored and jurisdiction-prefixed (`GST-001`,
 * `TDS-001`) so a reviewer can tell at a glance which pack a criterion came from.
 */
export const ComplianceRuleKeySchema = z
  .string()
  .regex(/^[A-Z]{2,6}-[0-9]{3}$/, 'rule key must look like GST-001');

/** Opaque surrogate key for rows we create (specs, artifact versions, audit entries). */
export const EntityIdSchema = z.string().min(1).max(64);

/** Formats a 1-based sequence number into a padded, prefixed id. */
export function formatId(prefix: string, n: number): string {
  if (!Number.isInteger(n) || n < 1) {
    throw new RangeError(`sequence number must be a positive integer, received ${String(n)}`);
  }
  return `${prefix}-${String(n).padStart(3, '0')}`;
}
