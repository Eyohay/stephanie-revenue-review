import type { SessionOptions } from 'iron-session';

export interface SessionData {
  authenticated?: boolean;
}

export const sessionOptions: SessionOptions = {
  password:
    process.env.SESSION_PASSWORD ||
    'complex_password_at_least_32_characters_long_for_development_only',
  cookieName: 'stephanie-revenue-review-session',
  cookieOptions: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7,
  },
};
