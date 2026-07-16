// Central place to read required server-only env vars with a consistent,
// non-leaky failure mode (throws — callers turn that into a generic 500,
// never echoing which var was missing back to the client).

// process.env is the reliable source at runtime: on Vercel's Node serverless
// functions the platform injects configured env vars directly into
// process.env, but a build only statically inlines LITERAL
// `import.meta.env.NAME` reads, not this dynamic bracket lookup — so
// import.meta.env would be undefined here in the deployed function even
// though the vars are set. import.meta.env[name] is kept as a fallback
// purely for `astro dev`, where Astro does not copy .env.local into
// process.env (it only does so during `astro build`) but does expose a live
// import.meta.env with the loaded vars. Because the fallback is a dynamic
// (computed-key) access, Vite never statically inlines it into the built
// bundle, so it carries none of the literal-inlining secret-leak risk.
export function requireEnv(name: string): string {
  const value = process.env[name] || import.meta.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function optionalEnv(name: string, fallback: string): string {
  return process.env[name] || import.meta.env[name] || fallback;
}
