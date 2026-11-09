/**
 * Deterministic markdown renderers.
 *
 * JSON in, markdown out, no side effects. Covered by golden-file tests so a careless
 * formatting change cannot silently alter a document a reviewer has already approved.
 */

export { renderRequirements } from './requirements.ts';
export { renderDesign } from './design.ts';
export { renderTasks } from './tasks.ts';
export {
  EARS_LABELS,
  bullets,
  cell,
  finalise,
  inlineList,
  joinBlocks,
  sourceRef,
  table,
} from './format.ts';
