export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // R16 T1 — fail loud at startup if JWT_SECRET is unset/weak/placeholder rather than
    // silently signing forgeable session cookies. This is the real server-boot hook — it
    // does NOT run during `next build` or in tests, so it won't break those.
    const { validateJwtSecret } = await import('./lib/auth');
    validateJwtSecret();

    // T0-1 — run the data-durability self-check FIRST, before anything opens the
    // DB, so it can detect an ephemeral/fresh volume and alarm loudly in logs.
    const { runStartupDurabilityCheck } = await import('./lib/durability');
    await runStartupDurabilityCheck();

    const { startScheduler } = await import('./lib/scheduler');
    startScheduler();
  }
}
