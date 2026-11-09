import type { Requirement, RequirementsProposal } from '@agentforge/contract';
import {
  EARS_LABELS,
  bullets,
  finalise,
  inlineList,
  joinBlocks,
  sourceRef,
  table,
} from './format.ts';

/**
 * `requirements.md` renderer.
 *
 * Pure: the same proposal always renders byte-identically. That property is what lets
 * the content hash be computed from the JSON payload alone and still describe what a
 * reviewer read.
 */

function renderRequirement(req: Requirement): string {
  const criteria = table(
    ['ID', 'Given', 'When', 'Then', 'Compliance'],
    req.acceptance_criteria.map((ac) => [
      ac.id,
      ac.given,
      ac.when,
      ac.then,
      ac.compliance_rule_key ?? '—',
    ]),
  );

  const parts = [
    `### ${req.id} — ${EARS_LABELS[req.ears_pattern]}`,
    `**Statement.** ${req.ears_statement}`,
    `**Rationale.** ${req.rationale}`,
    `**Priority.** ${req.priority}`,
    `#### Acceptance criteria\n\n${criteria}`,
  ];

  if (req.source_refs.length > 0) {
    parts.push(`#### Evidence\n\n${bullets(req.source_refs.map(sourceRef))}`);
  }

  if (req.compliance_refs.length > 0) {
    parts.push(`**Compliance rules.** ${inlineList(req.compliance_refs)}`);
  }

  return joinBlocks(parts);
}

export function renderRequirements(title: string, proposal: RequirementsProposal): string {
  const blocks: string[] = [`# Requirements: ${title}`, proposal.feature_summary];

  if (proposal.non_goals.length > 0) {
    blocks.push(`## Non-goals\n\n${bullets(proposal.non_goals)}`);
  }

  if (proposal.clarification_questions.length > 0) {
    blocks.push(
      `## Open questions\n\n${table(
        ['Question', 'Why it matters', 'Suggested answers'],
        proposal.clarification_questions.map((q) => [
          q.question,
          q.why_it_matters,
          inlineList(q.options),
        ]),
      )}`,
    );
  }

  if (proposal.requirements.length === 0) {
    blocks.push(
      '## Requirements\n\nNone proposed yet; the open questions above must be answered first.',
    );
  } else {
    blocks.push('## Requirements');
    for (const req of proposal.requirements) {
      blocks.push(renderRequirement(req));
    }

    // A compact index, so a reviewer can see the shape of the whole set before reading it.
    blocks.push(
      `## Traceability index\n\n${table(
        ['Requirement', 'Priority', 'Criteria', 'Evidence', 'Compliance'],
        proposal.requirements.map((req) => [
          req.id,
          req.priority,
          String(req.acceptance_criteria.length),
          String(req.source_refs.length),
          inlineList(req.compliance_refs),
        ]),
      )}`,
    );
  }

  return finalise(joinBlocks(blocks));
}
