import type { RoomStatus } from "./types";

export type JoinGateView = "loading" | "confirm" | "join";

export function joinGateView({
  loading,
  current,
  code,
  confirmed,
}: {
  loading: boolean;
  current: { code: string; status: RoomStatus } | null;
  code: string;
  confirmed: boolean;
}): JoinGateView {
  if (loading) return "loading";
  if (current && current.status !== "closed" && current.code !== code && !confirmed) return "confirm";
  return "join";
}
