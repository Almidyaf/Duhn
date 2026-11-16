import { betterAuth } from 'better-auth';
import { getDynamicPool } from './db';

export function createAuth(allowBootstrapSignup = false) {
  if (!process.env.BETTER_AUTH_SECRET || process.env.BETTER_AUTH_SECRET.length < 32) {
    throw new Error('Configure a random BETTER_AUTH_SECRET of at least 32 characters.');
  }
  if (!process.env.BETTER_AUTH_URL) throw new Error('BETTER_AUTH_URL is required.');
  return betterAuth({
    database: getDynamicPool(),
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: process.env.BETTER_AUTH_URL,
    trustedOrigins: [new URL(process.env.BETTER_AUTH_URL).origin],
    emailAndPassword: {
      enabled: true,
      disableSignUp: !allowBootstrapSignup,
      minPasswordLength: 12,
    },
    session: {
      expiresIn: 60 * 60 * 8,
      updateAge: 60 * 60,
      cookieCache: { enabled: true, maxAge: 60 },
    },
    rateLimit: { enabled: true, storage: 'database', window: 60, max: 60 },
  });
}

let instance: ReturnType<typeof createAuth> | undefined;
export function getAuth() {
  return (instance ??= createAuth());
}
