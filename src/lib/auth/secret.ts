/**
 * Production guard for Better Auth's signing secret (dependency-free so the
 * node test runner can load it without the auth server's pg/PGLite imports).
 *
 * Without `BETTER_AUTH_SECRET`, `server.ts` signs with a random per-process
 * secret. That is right for local dev and the workspace preview, but on a
 * deployed instance every cold start mints a new secret and silently logs
 * everyone out. So a deployed production runtime refuses to USE auth without
 * the secret.
 *
 * The check is lazy and auth-gated on purpose: importing the auth module or
 * booting never throws, and an app with auth off (`VITE_AUTH_ENABLED=false`)
 * never throws. Only the first real sign-in / session read (`auth.api` or
 * `auth.handler`) with auth on fails, with a message that names the fix.
 */

type Env = Record<string, string | undefined>;

const read = (e: Env, key: string): string | undefined => {
  const value = e[key]?.trim();
  return value ? value : undefined;
};

/**
 * True only for a deployed production runtime. Local `vite dev`, the built QA
 * preview (`vite preview` with no deploy markers) and host preview deploys
 * (Vercel `VERCEL_ENV=preview`, Netlify `CONTEXT=deploy-preview`) keep the
 * random-secret fallback.
 */
export function isDeployedProduction(e: Env = process.env): boolean {
  const vercelEnv = read(e, "VERCEL_ENV");
  const netlifyContext = read(e, "CONTEXT");
  if (vercelEnv && vercelEnv !== "production") return false;
  if (netlifyContext && netlifyContext !== "production") return false;
  if (vercelEnv === "production" || netlifyContext === "production") return true;
  // Grok deployer markers: it writes GROK_PROJECT_ID and BETTER_AUTH_URL on publish.
  return (
    read(e, "NODE_ENV") === "production" &&
    Boolean(read(e, "GROK_PROJECT_ID") || read(e, "BETTER_AUTH_URL"))
  );
}

export class MissingAuthSecretError extends Error {
  constructor() {
    super(
      "[auth] BETTER_AUTH_SECRET is not set on this production deploy. Refusing " +
        "to sign sessions with a random per-instance secret (every cold start " +
        "would sign everyone out). Set BETTER_AUTH_SECRET on the host, or turn " +
        "auth off with VITE_AUTH_ENABLED=false.",
    );
    this.name = "MissingAuthSecretError";
  }
}

/** Auth is on unless explicitly switched off (same rule as `server.ts`). */
export function authEnabled(e: Env = process.env): boolean {
  return read(e, "VITE_AUTH_ENABLED") !== "false";
}

/**
 * Throws `MissingAuthSecretError` when auth is on in a deployed production
 * runtime that has no `BETTER_AUTH_SECRET`. A no-op everywhere else.
 */
export function assertAuthSecret(e: Env = process.env): void {
  if (authEnabled(e) && isDeployedProduction(e) && !read(e, "BETTER_AUTH_SECRET")) {
    throw new MissingAuthSecretError();
  }
}

/**
 * Wrap the Better Auth instance so `check` runs on first use of `api` or
 * `handler` (sign-in, callback, session read), never at import.
 */
export function guardAuthUse<T extends object>(target: T, check: () => void): T {
  return new Proxy(target, {
    get(obj, prop, receiver) {
      if (prop === "api" || prop === "handler") check();
      return Reflect.get(obj, prop, receiver);
    },
  });
}
