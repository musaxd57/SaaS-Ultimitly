import "server-only";

// Master switch for the Durable Outbox (#8). Default OFF: when unset, NOTHING
// enqueues and no worker runs, so the live send path is EXACTLY today's
// deliver-then-persist + claim-then-send. Flip to "1" (per-env) to route outbound
// sends through the durable outbox. See DEPLOYMENT.md.
export function durableOutboxEnabled(): boolean {
  return process.env.DURABLE_OUTBOX_ENABLED === "1";
}
