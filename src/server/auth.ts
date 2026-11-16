import { betterAuth } from 'better-auth';
import { getPool } from './db';

export function createAuth(allowBootstrapSignup = false) {
  if (!process.env.BETTER_AUTH_SECRET || process.env.BETTER_AUTH_SECRET.length < 32) {
    throw new Error('Configure a random BETTER_AUTH_SECRET of at least 32 characters.');
  }
  if (!process.env.BETTER_AUTH_URL) throw new Error('BETTER_AUTH_URL is required.');
  return betterAuth({
    database: getPool(),
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: process.env.BETTER_AUTH_URL,
    trustedOrigins: [new URL(process.env.BETTER_AUTH_URL).origin],
    emailAndPassword: {
      enabled: true,
      disableSignUp: !allowBootstrapSignup,
      minPasswordLength: 12,
    },
    session: { expiresIn: 60 * 60 * 8, updateAge: 60 * 60, cookieCache: { enabled: false } },
    rateLimit: { enabled: true, storage: 'database', window: 60, max: 60 },
  });
}

let instance: ReturnType<typeof createAuth> | undefined;
export function getAuth() {
  if (Symbol.for('__cloudflare-context__') in globalThis) {
    return createAuth();
  }
  return (instance ??= createAuth());
}
