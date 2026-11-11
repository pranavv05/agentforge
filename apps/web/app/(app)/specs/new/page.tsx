import type { Metadata } from 'next';
import Link from 'next/link';
import { CreateSpecForm } from './create-form';

export const metadata: Metadata = {
  title: 'New spec',
};

/**
 * Start a spec from a feature request.
 *
 * Deliberately a short form. The point of the product is that the pipeline turns a
 * loosely worded request into structured requirements — asking the user to pre-structure
 * it here would be doing the agent's job for it, badly.
 */
export default function NewSpecPage() {
  return (
    <>
      <div className="page__head">
        <nav className="crumbs" aria-label="Breadcrumb">
          <Link href="/specs">Specs</Link>
          <span aria-hidden="true">/</span>
          <span>new</span>
        </nav>

        <h1 className="page__title">New spec</h1>
        <p className="page__lede">
          Describe the feature the way you would to a colleague. The Requirement Agent turns it into
          EARS statements with testable acceptance criteria, and asks you questions if it cannot.
        </p>
      </div>

      <CreateSpecForm />
    </>
  );
}
