/** Load .env for CLI scripts (Next.js loads it automatically for the app). */
try {
  process.loadEnvFile(".env");
} catch {
  /* no .env file; rely on the process environment */
}
