import { describe, expect, it } from 'vitest';
import type { ContextEvidence } from '@agentforge/contract';
import { evidenceSection } from '../src/sections.ts';
import { checkAllCitations } from '../src/citations.ts';

/**
 * What the evidence block hands the model.
 *
 * The block tells the model to copy the symbol "exactly as given", so whatever appears
 * in it comes back in the next response. That makes the rendering a *contract*, not
 * formatting: a value here that the schema cannot accept is a failure the model gets
 * blamed for.
 *
 * It happened. A null symbol rendered as the text `(region)`, the model copied it as
 * instructed, and the citation checker refused the result with "EV-003 names symbol
 * (none), but the citation claims `(region)`" — the system rejecting its own
 * placeholder. These tests exist so that cannot come back.
 */

function evidence(overrides: Partial<ContextEvidence> = {}): ContextEvidence {
  return {
    id: 'EV-001',
    file: 'src/billing/invoice.ts',
    line_start: 9,
    line_end: 12,
    symbol: 'finaliseInvoice',
    claim: 'Invoice finalisation runs through a single function.',
    relevance: 'The export must only accept a finalised invoice.',
    verified: true,
    failure_reason: null,
    ...overrides,
  };
}

describe('the evidence block', () => {
  it('renders a region as null, not as prose', () => {
    const text = evidenceSection([evidence({ id: 'EV-002', symbol: null })]).text;

    expect(text).toContain('- symbol: null');
    // The exact string that leaked into a typed field on a live run.
    expect(text).not.toContain('(region)');
  });

  it('renders a named symbol in backticks', () => {
    const text = evidenceSection([evidence()]).text;
    expect(text).toContain('- symbol: `finaliseInvoice`');
  });

  it('offers only verified evidence', () => {
    // An unverified claim is a measurement we keep, not material to build on. Handing it
    // to the next agent would launder a failed citation into an approved document.
    const text = evidenceSection([
      evidence({ id: 'EV-001' }),
      evidence({ id: 'EV-009', verified: false, failure_reason: 'file_not_found' }),
    ]).text;

    expect(text).toContain('EV-001');
    expect(text).not.toContain('EV-009');
  });

  it('emits nothing when there is no verified evidence', () => {
    expect(evidenceSection([evidence({ verified: false })]).text).toBe('');
  });

  it('never renders a symbol the checker would then reject', () => {
    // The round trip, asserted directly: whatever the block shows for a symbol, a
    // citation copying it verbatim has to pass. This is the property the old
    // `(region)` placeholder violated.
    const rows = [
      evidence({ id: 'EV-001', symbol: 'finaliseInvoice' }),
      evidence({ id: 'EV-002', symbol: null }),
    ];

    const text = evidenceSection(rows).text;

    for (const row of rows) {
      const rendered = /- symbol: (.*)$/m.exec(text.slice(text.indexOf(`### ${row.id}`)))?.[1];

      // Undo the display formatting the way a model reading this would: backticks mean
      // a literal name, and the bare word null means null.
      const copied = rendered === 'null' ? null : (rendered ?? '').replace(/^`|`$/g, '');

      const violations = checkAllCitations(rows, [
        {
          location: 'requirements[0].source_refs',
          refs: [
            {
              evidence_id: row.id,
              file: row.file,
              line_start: row.line_start,
              line_end: row.line_end,
              symbol: copied,
            },
          ],
        },
      ]);

      expect(violations, `citing ${row.id} as rendered`).toEqual([]);
    }
  });
});
