import { cookies } from 'next/headers';
import { getIronSession } from 'iron-session';
import { sessionOptions, type SessionData } from './session';

export async function getSession(): Promise<{ authenticated: boolean } | null> {
  const session = await getIronSession<SessionData>(cookies(), sessionOptions);
  if (!session.authenticated) return null;
  return { authenticated: true };
}
