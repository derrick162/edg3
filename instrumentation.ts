export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // T0-1 — run the data-durability self-check FIRST, before anything opens the
    // DB, so it can detect an ephemeral/fresh volume and alarm loudly in logs.
    const { runStartupDurabilityCheck } = await import('./lib/durability');
    await runStartupDurabilityCheck();

    const { startScheduler } = await import('./lib/scheduler');
    startScheduler();
  }
}
