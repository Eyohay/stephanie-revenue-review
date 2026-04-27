import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { getIronSession } from 'iron-session';
import { timingSafeEqual } from 'crypto';
import { sessionOptions, type SessionData } from '@/lib/session';

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

async function login(formData: FormData) {
  'use server';
  const password = formData.get('password');
  if (typeof password !== 'string' || !password) redirect('/login?e=1');

  const pw = process.env.DASHBOARD_PASSWORD;
  if (!pw) throw new Error('DASHBOARD_PASSWORD must be set');

  if (!safeEqual(password, pw)) redirect('/login?e=1');

  const session = await getIronSession<SessionData>(cookies(), sessionOptions);
  session.authenticated = true;
  await session.save();
  redirect('/');
}

export default function LoginPage({ searchParams }: { searchParams: { e?: string } }) {
  const showError = searchParams.e === '1';
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-gray-50">
      <form action={login} className="w-full max-w-sm bg-white border rounded-lg shadow-sm p-6">
        <h1 className="text-xl font-semibold mb-1">Stephanie Revenue Review</h1>
        <p className="text-sm text-gray-500 mb-5">Enter the dashboard password to continue.</p>
        <label className="block text-sm font-medium mb-1">Password</label>
        <input
          name="password"
          type="password"
          autoFocus
          required
          className="w-full border border-gray-300 rounded px-3 py-2 mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        {showError && <p className="text-sm text-red-600 mb-3">Incorrect password.</p>}
        <button
          type="submit"
          className="w-full bg-blue-600 text-white rounded py-2 font-medium hover:bg-blue-700"
        >
          Sign in
        </button>
      </form>
    </div>
  );
}
