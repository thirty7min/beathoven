import { GameError, type GameErrorCode } from "./errors";

const TRANSIENT_CODES: ReadonlySet<GameErrorCode> = new Set(["unknown", "rate_limited"]);

export function isTransientError(error: unknown): boolean {
  return !(error instanceof GameError) || TRANSIENT_CODES.has(error.code);
}

export function isMissingRpc(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === "PGRST202" || error.code === "42883" || /could not find the function/i.test(error.message ?? "");
}
