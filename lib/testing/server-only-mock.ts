// Empty module to replace "server-only" in the test environment.
// The real "server-only" package throws at import time when loaded
// outside of a React Server Component context, which blocks Vitest.
export {};
