import type { Metadata } from 'next';
import { Composer } from '@/components/workspace/composer';

export const metadata: Metadata = {
  title: 'New spec',
};

/**
 * The empty state.
 *
 * One question and one box. The examples below it are real shapes the pipeline handles
 * — including a Hinglish request, because the Requirement Agent accepts mixed-language
 * input and produces English documents, and that is worth showing rather than claiming.
 */

const EXAMPLES: readonly string[] = [
  'Export a finalised invoice as GST e-invoice JSON, refusing to produce a payload when a mandatory field is missing.',
  'Deduct TDS at the Section 393 rate when paying a vendor, and record the payment code used.',
  'Humein chahiye ki har financial year ka apna gap-free invoice numbering series ho.',
];

export default function NewThreadPage() {
  return (
    <main className="stage">
      <div className="empty">
        <div className="empty__inner">
          <h1 className="empty__title">What do you want to build?</h1>
          <p className="empty__lede">
            Describe it in plain prose. The Requirement Agent turns it into EARS statements with
            testable acceptance criteria, asks you questions where it cannot, and every document
            stops at a gate you have to pass.
          </p>

          <Composer autoFocus />

          <ul className="empty__examples">
            {EXAMPLES.map((example) => (
              <li className="empty__example" key={example}>
                {example}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </main>
  );
}
