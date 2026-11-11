/**
 * `@agentforge/compliance` — compliance as acceptance criteria.
 *
 * Turns regulation into testable Given/When/Then criteria, injects the applicable ones
 * into requirements, detects superseded statutory terminology, and traces each
 * obligation forward to a task and a test.
 *
 * The pack is versioned and stored, because the law it encodes changes: the Income-tax
 * Act 2025 dissolved the 194-series on 1 April 2026, and an unversioned checklist would
 * still be asserting Section 194J today.
 */

export { COMPLIANCE_PACK, PACK_VERSION, REVIEWED_ON } from './pack.ts';

export {
  blockingViolations,
  compileDetectors,
  describeViolation,
  detectSupersededTerms,
  type ScanTarget,
} from './detect.ts';

export {
  applicableRules,
  injectCriteria,
  matchedKeywords,
  renderPackForPrompt,
  type FeatureText,
  type InjectedCriterion,
} from './apply.ts';

export { buildTraceMatrix, unscheduledRules, untracedRules, type TraceInput } from './trace.ts';

export {
  installedPackVersion,
  loadPack,
  readPack,
  readTraces,
  recordTestRef,
  saveTraces,
} from './store.ts';
