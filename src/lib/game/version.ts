export type VersionDecision = "stale" | "apply" | "gap";

/**
 * `room_state` events carry the full public state, so any newer version can be
 * applied. A jump of more than one still means events were missed, and the
 * caller should resync to pick up what broadcasts don't carry (own votes, chat).
 */
export function decideVersion(local: number | null, incoming: number): VersionDecision {
  if (local === null) return "gap";
  if (incoming <= local) return "stale";
  if (incoming === local + 1) return "apply";
  return "gap";
}
