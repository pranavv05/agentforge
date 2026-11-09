import type { DesignProposal, DesignSection } from '@agentforge/contract';
import { bullets, finalise, inlineList, joinBlocks, sourceRef, table } from './format.ts';

/**
 * `design.md` renderer.
 *
 * The `Evidence` line under each section is the visible form of the evidence-checked
 * claim: every codebase assertion carries a file:line reference that the grounding
 * verifier has already checked. A section with no evidence in a brownfield spec is a
 * flag, not a convenience.
 */

function renderSection(section: DesignSection): string {
  const parts = [`### ${section.id} — ${section.heading}`, section.body];

  parts.push(`**Implements.** ${inlineList(section.requirement_ids)}`);

  if (section.source_refs.length > 0) {
    parts.push(`**Evidence.**\n\n${bullets(section.source_refs.map(sourceRef))}`);
  }

  return joinBlocks(parts);
}

export function renderDesign(title: string, proposal: DesignProposal): string {
  const blocks: string[] = [`# Design: ${title}`, proposal.overview, '## Sections'];

  for (const section of proposal.sections) {
    blocks.push(renderSection(section));
  }

  if (proposal.decisions.length > 0) {
    blocks.push('## Decisions');
    for (const decision of proposal.decisions) {
      blocks.push(
        joinBlocks([
          `### ${decision.id}`,
          `**Decision.** ${decision.decision}`,
          `**Rationale.** ${decision.rationale}`,
          `**Alternatives considered.** ${inlineList(decision.alternatives_considered)}`,
        ]),
      );
    }
  }

  if (proposal.risks.length > 0) {
    blocks.push(`## Risks\n\n${bullets(proposal.risks)}`);
  }

  blocks.push(
    `## Requirement coverage\n\n${table(
      ['Section', 'Heading', 'Requirements', 'Evidence refs'],
      proposal.sections.map((s) => [
        s.id,
        s.heading,
        inlineList(s.requirement_ids),
        String(s.source_refs.length),
      ]),
    )}`,
  );

  return finalise(joinBlocks(blocks));
}
