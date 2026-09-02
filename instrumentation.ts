/**
 * Next.js Server Instrumentation Hook
 * Automatically boots the 4-hour model latency ping scheduler when deployed
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    try {
      const { initScheduledPings } = await import('./lib/pings');
      initScheduledPings();
    } catch (err) {
      console.error('[Instrumentation] Failed to register scheduled model pings:', err);
    }
  }
}
