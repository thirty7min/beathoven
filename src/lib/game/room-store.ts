import type { ChatMessage, MyVote, PresenceEntry, RoomSnapshot, RoomState, Submission } from "./types";

export const CHAT_HISTORY_LIMIT = 200;

export type ConnectionStatus = "connecting" | "live" | "reconnecting" | "error";

export type RoomViewState = {
  connection: ConnectionStatus;
  error: string | null;
  snapshot: RoomSnapshot | null;
  online: string[];
};

export type RoomAction =
  | { type: "snapshot"; snapshot: RoomSnapshot }
  | { type: "room_state"; state: RoomState }
  | { type: "chat"; message: ChatMessage }
  | { type: "my_vote"; vote: MyVote }
  | { type: "my_skip"; submissionId: string }
  | { type: "my_kick_vote"; targetId: string }
  | { type: "presence"; online: string[] }
  | { type: "connection"; status: ConnectionStatus; error?: string | null };

export const initialRoomViewState: RoomViewState = {
  connection: "connecting",
  error: null,
  snapshot: null,
  online: [],
};

export function mergeChat(existing: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const byId = new Map(existing.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => a.id - b.id).slice(-CHAT_HISTORY_LIMIT);
}

function mergeVotes(existing: MyVote[], incoming: MyVote[]): MyVote[] {
  const bySubmission = new Map(existing.map((v) => [v.submission_id, v]));
  for (const v of incoming) bySubmission.set(v.submission_id, v);
  return [...bySubmission.values()];
}

// Broadcasts are shared, so your own entry and skip votes only come from the snapshot.
export function personalize(snapshot: RoomSnapshot): RoomSnapshot {
  const mine = snapshot.my_submission ?? null;
  let submissions: Submission[] = snapshot.submissions;
  if (mine) {
    submissions = submissions.some((s) => s.id === mine.id)
      ? submissions.map((s) => (s.id === mine.id ? { ...s, user_id: mine.user_id } : s))
      : snapshot.room.status === "producing"
        ? [...submissions, mine]
        : submissions;
  }
  const skip = snapshot.skip
    ? { ...snapshot.skip, you_voted: (snapshot.my_skip_votes ?? []).includes(snapshot.skip.submission_id) }
    : snapshot.skip;
  const targets = new Set((snapshot.kick_votes ?? []).map((k) => k.target_user_id));
  const my_kick_votes = (snapshot.my_kick_votes ?? []).filter((id) => targets.has(id));
  return { ...snapshot, submissions, skip, my_kick_votes };
}

function withPublicState(snapshot: RoomSnapshot, state: RoomState): RoomSnapshot {
  const sameRound = state.room.round === snapshot.room.round;
  return personalize({
    ...snapshot,
    version: state.version,
    room: state.room,
    players: state.players,
    assets: state.assets,
    submissions: state.submissions,
    votes_cast: state.votes_cast,
    results: state.results,
    readiness: state.readiness,
    submitted_user_ids: state.submitted_user_ids,
    current_votes: state.current_votes,
    skip: state.skip,
    kick_votes: state.kick_votes,
    my_votes: sameRound ? snapshot.my_votes : [],
    my_submission: sameRound ? snapshot.my_submission : null,
    my_skip_votes: sameRound ? snapshot.my_skip_votes : [],
  });
}

export function roomReducer(view: RoomViewState, action: RoomAction): RoomViewState {
  switch (action.type) {
    case "snapshot": {
      const current = view.snapshot;
      const incoming = action.snapshot;
      if (!current) return { ...view, snapshot: personalize(incoming) };
      // A broadcast can land while a snapshot request is in flight; keep the newer public state.
      const base = incoming.version >= current.version ? incoming : withPublicState(incoming, current);
      const forRound = (s: RoomSnapshot) => (s.room.round === base.room.round ? s.my_votes : []);
      return {
        ...view,
        snapshot: personalize({
          ...base,
          my_votes: mergeVotes(forRound(current), forRound(incoming)),
          chat: mergeChat(current.chat, incoming.chat),
        }),
      };
    }
    case "room_state": {
      const current = view.snapshot;
      if (!current || action.state.version <= current.version) return view;
      return { ...view, snapshot: withPublicState(current, action.state) };
    }
    case "chat": {
      const current = view.snapshot;
      if (!current || action.message.room_id !== current.room.id) return view;
      return { ...view, snapshot: { ...current, chat: mergeChat(current.chat, [action.message]) } };
    }
    case "my_vote": {
      const current = view.snapshot;
      if (!current) return view;
      return { ...view, snapshot: { ...current, my_votes: mergeVotes(current.my_votes, [action.vote]) } };
    }
    case "my_kick_vote": {
      const current = view.snapshot;
      if (!current) return view;
      const votes = current.my_kick_votes ?? [];
      if (votes.includes(action.targetId)) return view;
      return { ...view, snapshot: { ...current, my_kick_votes: [...votes, action.targetId] } };
    }
    case "my_skip": {
      const current = view.snapshot;
      if (!current) return view;
      const votes = current.my_skip_votes ?? [];
      if (votes.includes(action.submissionId)) return view;
      return { ...view, snapshot: personalize({ ...current, my_skip_votes: [...votes, action.submissionId] }) };
    }
    case "presence":
      return { ...view, online: action.online };
    case "connection":
      return { ...view, connection: action.status, error: action.error ?? null };
  }
}

export function onlineUserIds(presenceState: Record<string, PresenceEntry[]>): string[] {
  const ids = new Set<string>();
  for (const entries of Object.values(presenceState)) {
    for (const entry of entries) if (entry.user_id) ids.add(entry.user_id);
  }
  return [...ids].sort();
}
