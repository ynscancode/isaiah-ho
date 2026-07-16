// Central place to read required server-only env vars with a consistent,
// non-leaky failure mode (throws — callers turn that into a generic 500,
// never echoing which var was missing back to the client).

export function requireEnv(name: string): string {
  const value = import.meta.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function optionalEnv(name: string, fallback: string): string {
  return import.meta.env[name] || fallback;
}
