'use client';

import Link from 'next/link';
import { useSession } from '@/lib/session';

export default function HomePage() {
  const { status, user } = useSession();
  return (
    <main className="content">
      <section className="hero">
        <h1>Private poker clubs for you and your friends</h1>
        <p>
          Create a club, invite your friends, hand out virtual chips and play No-Limit Texas
          Hold&apos;em in real time. Virtual chips have no monetary value.
        </p>
        {status === 'authenticated' && user ? (
          <Link className="btn primary" href="/clubs">
            Go to my clubs
          </Link>
        ) : status === 'anonymous' ? (
          <div className="row" style={{ justifyContent: 'center' }}>
            <Link className="btn primary" href="/register">
              Create an account
            </Link>
            <Link className="btn" href="/login">
              Log in
            </Link>
          </div>
        ) : null}
      </section>
    </main>
  );
}
