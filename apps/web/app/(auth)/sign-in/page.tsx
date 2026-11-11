import type { Metadata } from 'next';
import Link from 'next/link';
import { SignInForm } from './sign-in-form';

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to AgentForge.',
};

export default function SignInPage() {
  return (
    <div className="authCard">
      <h1 className="authCard__title">Sign in</h1>
      <p className="authCard__lede">
        Decisions you record are written to an append-only audit log under this account.
      </p>

      <SignInForm />

      <p className="authCard__alt">
        No account yet? <Link href="/sign-up">Create one</Link>
      </p>
    </div>
  );
}
