import type { Metadata } from 'next';
import { getDb } from '@agentforge/db';
import { listSpecs } from '@agentforge/orchestrator';
import { Composer } from '@/components/workspace/composer';
import { ExamplePrompts } from '@/components/workspace/example-prompts';

export const metadata: Metadata = {
  title: 'New spec',
};

/**
 * The empty state.
 *
 * One question and one box. The examples below it are real shapes the pipeline handles
 * — including a Hinglish request, because the Requirement Agent accepts mixed-language
 * input and produces English documents, and that is worth showing rather than claiming —
 * and choosing one fills the box.
 *
 * Someone with no specs yet also gets the three-step shape of what happens next. That is
 * the part a first-time user cannot infer from a text box: the product's whole point is
 * that documents stop at gates only a person can pass, and a user who does not know that
 * reads the first approval screen as friction rather than as the feature. It disappears
 * as soon as there is a thread, because after that it is clutter.
 */

const EXAMPLES: readonly string[] = [
  'Export a finalised invoice as GST e-invoice JSON, refusing to produce a payload when a mandatory field is missing.',
  'Deduct TDS at the Section 393 rate when paying a vendor, and record the payment code used.',
  'Humein chahiye ki har financial year ka apna gap-free invoice numbering series ho.',
];

const STEPS: readonly { readonly title: string; readonly body: string }[] = [
  {
    title: 'Describe it',
    body: 'Plain prose is fine. Choose “Existing repo” to have claims about your code checked against real files.',
  },
  {
    title: 'Pass three gates',
    body: 'Requirements, design and tasks each stop for you. Your approval binds to the exact document you read.',
  },
  {
    title: 'Hand it to Claude Code',
    body: 'Approving the tasks is what lets it edit files — and only after it has claimed one.',
  },
];

export default function NewThreadPage() {
  const firstRun =
    listSpecs(getDb(), { status: null, mode: null, limit: 1, offset: 0 }).specs.length === 0;

  return (
    <main id="main" tabIndex={-1} className="stage">
      <div className="empty">
        <div className="empty__inner">
          <h1 className="empty__title">What do you want to build?</h1>
          <p className="empty__lede">
            Describe it in plain prose. The Requirement Agent turns it into EARS statements with
            testable acceptance criteria, asks you questions where it cannot, and every document
            stops at a gate you have to pass.
          </p>

          <Composer autoFocus />

          <ExamplePrompts examples={EXAMPLES} />

          {firstRun && (
            <section className="steps" aria-labelledby="steps-h">
              <h2 className="steps__title" id="steps-h">
                How this works
              </h2>
              <ol className="steps__list">
                {STEPS.map((step) => (
                  <li className="steps__item" key={step.title}>
                    <strong>{step.title}</strong>
                    <span>{step.body}</span>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </div>
      </div>
    </main>
  );
}
