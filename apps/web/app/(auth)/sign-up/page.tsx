import type { Metadata } from 'next';
import Link from 'next/link';
import { SignUpForm } from './sign-up-form';

export const metadata: Metadata = {
  title: 'Create an account',
  description: 'Create an AgentForge account.',
};

export default function SignUpPage() {
  return (
    <div className="authCard">
      <h1 className="authCard__title">Create an account</h1>
      <p className="authCard__lede">
        Your name and email are recorded against every decision you make, permanently.
      </p>

      <SignUpForm />

      <p className="authCard__alt">
        Already have an account? <Link href="/sign-in">Sign in</Link>
      </p>
    </div>
  );
}
