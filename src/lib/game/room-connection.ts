import type { RealtimeChannel } from "@supabase/supabase-js";
import { ensureSession, type TypedSupabaseClient } from "@/lib/supabase/client";
import { Backoff } from "./backoff";
import { ServerClock } from "./clock";
import { isMissingRpc, isTransientError } from "./error-kind";
import { GameError, toGameError } from "./errors";
import { advanceDueAt } from "./phase";
import { onlineUserIds, roomReducer, initialRoomViewState, type RoomAction, type RoomViewState } from "./room-store";
import * as rpc from "./rpc";
import { uploadSubmission, type UploadProgress } from "./storage";
import type { ChatMessage, PresenceEntry, RoomState } from "./types";
import { decideVersion } from "./version";

const ADVANCE_JITTER_MS = 400;
const BROADCAST_GRACE_MS = 1500;
const RESYNC_HEARTBEAT_MS = 30_000;
const TOUCH_HEARTBEAT_MS = 20_000;

export class RoomConnection {
  readonly clock = new ServerClock();
  private view: RoomViewState = initialRoomViewState;
  private listeners = new Set<() => void>();
  private generation = 0;
  private roomId: string | null = null;
  private userId: string | null = null;
  private channel: RealtimeChannel | null = null;
  private channelJoined = false;
  private presenceTracked = false;
  private resyncInFlight: Promise<void> | null = null;
  private resyncAgain = false;
  private resyncRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly resyncBackoff = new Backoff(1000, 15_000);
  private advanceTimer: ReturnType<typeof setTimeout> | null = null;
  private advanceKey: string | null = null;
  private readonly advanceBackoff = new Backoff(1000, 8000);
  private reopenTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly reopenBackoff = new Backoff(1000, 15_000);
  private resyncHeartbeat: ReturnType<typeof setInterval> | null = null;
  private touchHeartbeat: ReturnType<typeof setInterval> | null = null;
  private detachWindow: (() => void) | null = null;

  constructor(
    private readonly supabase: TypedSupabaseClient,
    private readonly code: string,
  ) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getState = () => this.view;

  async start() {
    const gen = ++this.generation;
    this.clearTimers();
    this.dispatch({ type: "connection", status: "connecting" });
    try {
      const userId = await ensureSession(this.supabase);
      const { room_id } = await rpc.joinRoom(this.supabase, this.code);
      if (gen !== this.generation) return;
      this.userId = userId;
      this.roomId = room_id;
      void this.syncClock();
      this.openChannel(gen);
      this.attachWindow();
      this.resyncHeartbeat = setInterval(() => void this.resync(), RESYNC_HEARTBEAT_MS);
      this.touchHeartbeat = setInterval(() => void this.touch(), TOUCH_HEARTBEAT_MS);
    } catch (error) {
      if (gen === this.generation) this.fail(error);
    }
  }

  stop() {
    this.generation++;
    this.clearTimers();
    this.detachWindow?.();
    this.detachWindow = null;
    this.dropChannel();
    this.roomId = null;
  }

  readonly actions = {
    setReady: (ready: boolean) => this.mutate((id) => rpc.setReady(this.supabase, id, ready)),
    startGame: (options?: { force?: boolean }) => this.mutate((id) => rpc.startGame(this.supabase, id, options)),
    leave: () => this.mutate((id) => rpc.leaveRoom(this.supabase, id)),
    updateSettings: (changes: Parameters<typeof rpc.updateRoomSettings>[2]) =>
      this.mutate((id) => rpc.updateRoomSettings(this.supabase, id, changes)),
    sendChat: (body: string) => this.mutate((id) => rpc.sendChat(this.supabase, id, body)),
    advance: () => this.mutate((id) => rpc.advanceRoom(this.supabase, id)),
    castVote: async (submissionId: string, score: number) => {
      await this.mutate((id) => rpc.castVote(this.supabase, id, submissionId, score));
      this.dispatch({ type: "my_vote", vote: { submission_id: submissionId, score } });
    },
    submitTrack: async (file: File, _clientDurationMs?: number, onProgress?: UploadProgress, signal?: AbortSignal) => {
      const { submissionId } = await this.mutate((id) => uploadSubmission(id, file, { onProgress, signal }));
      // Your own entry only arrives privately in the snapshot.
      void this.resync();
      return submissionId;
    },
    kickPlayer: (userId: string) => this.mutate((id) => rpc.kickPlayer(this.supabase, id, userId)),
    voteKick: async (targetId: string) => {
      const result = await this.mutate((id) => rpc.voteKick(this.supabase, id, targetId));
      if (!result.kicked) this.dispatch({ type: "my_kick_vote", targetId });
      return result;
    },
    skipTrack: async () => {
      const submissionId = this.view.snapshot?.skip?.submission_id;
      const result = await this.mutate((id) => rpc.skipTrack(this.supabase, id));
      if (submissionId) this.dispatch({ type: "my_skip", submissionId });
      return result;
    },
  };

  private async mutate<T>(fn: (roomId: string) => Promise<T>): Promise<T> {
    if (!this.roomId) throw new GameError("not_member", "room not joined");
    try {
      return await fn(this.roomId);
    } catch (error) {
      if (error instanceof GameError && (error.code === "wrong_phase" || error.code === "deadline_passed")) {
        void this.resync();
      }
      throw error;
    }
  }

  private dispatch(action: RoomAction) {
    const next = roomReducer(this.view, action);
    if (next === this.view) return;
    this.view = next;
    for (const listener of this.listeners) listener();
    this.scheduleAdvance();
  }

  private fail(error: unknown) {
    this.dispatch({ type: "connection", status: "error", error: error instanceof Error ? error.message : String(error) });
  }

  private async syncClock() {
    const gen = this.generation;
    try {
      await this.clock.sync(() => rpc.serverTime(this.supabase));
    } catch {
      // Keep the previous offset; the next resync or wake retries.
      return;
    }
    // The first snapshot usually lands before the clock syncs; re-plan the advance with the real offset.
    if (gen === this.generation) this.scheduleAdvance();
  }

  private openChannel(gen: number) {
    const roomId = this.roomId;
    if (!roomId) return;
    const channel = this.supabase.channel(`room:${roomId}`, { config: { private: true } });
    channel
      .on("broadcast", { event: "room_state" }, ({ payload }) => this.onRoomState(payload as RoomState))
      .on("broadcast", { event: "chat" }, ({ payload }) => this.dispatch({ type: "chat", message: payload as ChatMessage }))
      .on("presence", { event: "sync" }, () => {
        if (this.channel !== channel) return;
        this.dispatch({ type: "presence", online: onlineUserIds(channel.presenceState<PresenceEntry>()) });
      });

    void this.supabase.realtime.setAuth().then(() => {
      if (gen !== this.generation || this.channel !== channel) return;
      channel.subscribe((status, error) => {
        if (gen !== this.generation || this.channel !== channel) return;
        if (status === "SUBSCRIBED") this.onChannelJoined();
        else this.onChannelLost(gen, error?.message ?? null);
      });
    });
    this.channel = channel;
    this.channelJoined = false;
    this.presenceTracked = false;
  }

  // removeChannel on a non-joined channel fires CLOSED synchronously, so detach first.
  private dropChannel() {
    const stale = this.channel;
    this.channel = null;
    this.channelJoined = false;
    if (stale) void this.supabase.removeChannel(stale);
  }

  private onChannelJoined() {
    this.channelJoined = true;
    this.presenceTracked = false;
    this.reopenBackoff.reset();
    this.dispatch({ type: "connection", status: "live" });
    void this.ensurePresence();
    void this.resync();
  }

  private onChannelLost(gen: number, error: string | null) {
    this.channelJoined = false;
    this.dispatch({ type: "connection", status: "reconnecting", error });
    this.scheduleReopen(gen);
  }

  private async ensurePresence() {
    const channel = this.channel;
    const userId = this.userId;
    if (!channel || !userId || !this.channelJoined || this.presenceTracked) return;
    this.presenceTracked = true;
    const result = await channel
      .track({ user_id: userId, online_at: new Date().toISOString() } satisfies PresenceEntry)
      .catch(() => "error" as const);
    if (result !== "ok" && this.channel === channel) this.presenceTracked = false;
  }

  private scheduleReopen(gen: number) {
    if (this.reopenTimer) return;
    this.reopenTimer = setTimeout(() => {
      this.reopenTimer = null;
      if (gen !== this.generation || this.channelJoined) return;
      this.dropChannel();
      this.openChannel(gen);
    }, this.reopenBackoff.next());
  }

  private onRoomState(state: RoomState) {
    const decision = decideVersion(this.view.snapshot?.version ?? null, state.version);
    if (decision === "stale") return;
    this.dispatch({ type: "room_state", state });
    if (decision === "gap") void this.resync();
  }

  resync(): Promise<void> {
    if (this.resyncInFlight) {
      this.resyncAgain = true;
      return this.resyncInFlight;
    }
    const gen = this.generation;
    this.resyncInFlight = (async () => {
      try {
        do {
          this.resyncAgain = false;
          const roomId = this.roomId;
          if (!roomId) return;
          const snapshot = await rpc.getRoomSnapshot(this.supabase, roomId);
          if (gen !== this.generation) return;
          this.dispatch({ type: "snapshot", snapshot });
        } while (this.resyncAgain);
        this.onResyncSucceeded();
      } catch (error) {
        if (gen !== this.generation) return;
        if (!isTransientError(error)) {
          this.fail(error);
          return;
        }
        this.dispatch({ type: "connection", status: "reconnecting", error: error instanceof Error ? error.message : String(error) });
        this.scheduleResyncRetry();
      } finally {
        this.resyncInFlight = null;
      }
    })();
    return this.resyncInFlight;
  }

  private onResyncSucceeded() {
    this.resyncBackoff.reset();
    if (this.resyncRetryTimer) clearTimeout(this.resyncRetryTimer);
    this.resyncRetryTimer = null;
    if (!this.channelJoined) return;
    this.dispatch({ type: "connection", status: "live" });
    void this.ensurePresence();
  }

  private scheduleResyncRetry() {
    if (this.resyncRetryTimer) return;
    this.resyncRetryTimer = setTimeout(() => {
      this.resyncRetryTimer = null;
      void this.resync();
    }, this.resyncBackoff.next());
  }

  private async touch() {
    const roomId = this.roomId;
    if (!roomId) return;
    try {
      const { error } = await this.supabase.rpc("touch_room", { p_room_id: roomId });
      if (error && !isMissingRpc(error) && toGameError(error).code === "not_member") void this.resync();
    } catch {
      // Best effort; the next beat retries.
    }
  }

  // Every client races to call advance_room; the server's row lock makes the extras no-ops.
  private scheduleAdvance() {
    const snapshot = this.view.snapshot;
    const dueAt = snapshot ? advanceDueAt(snapshot.room) : null;
    const key = snapshot && dueAt !== null ? `${snapshot.version}:${dueAt}:${this.clock.offset}` : null;
    if (key === this.advanceKey) return;
    this.advanceKey = key;
    this.advanceBackoff.reset();
    if (this.advanceTimer) clearTimeout(this.advanceTimer);
    this.advanceTimer = null;
    if (dueAt === null) return;
    const delay = Math.max(0, this.clock.toLocal(dueAt) - Date.now()) + Math.random() * ADVANCE_JITTER_MS;
    this.advanceTimer = setTimeout(() => void this.tryAdvance(key!), delay);
  }

  private async tryAdvance(key: string) {
    const roomId = this.roomId;
    const local = this.view.snapshot?.version;
    if (!roomId || local === undefined || key !== this.advanceKey) return;
    try {
      const result = await rpc.advanceRoom(this.supabase, roomId);
      if (key !== this.advanceKey) return;
      if (result.version > local) {
        setTimeout(() => {
          if ((this.view.snapshot?.version ?? 0) < result.version) void this.resync();
        }, BROADCAST_GRACE_MS);
        return;
      }
    } catch (error) {
      if (key !== this.advanceKey || !isTransientError(error)) return;
    }
    this.advanceTimer = setTimeout(() => void this.tryAdvance(key), this.advanceBackoff.next());
  }

  private attachWindow() {
    if (typeof window === "undefined" || this.detachWindow) return;
    const wake = () => {
      if (document.visibilityState !== "visible") return;
      void this.syncClock();
      void this.resync();
      void this.touch();
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    window.addEventListener("pageshow", wake);
    this.detachWindow = () => {
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
      window.removeEventListener("pageshow", wake);
    };
  }

  private clearTimers() {
    if (this.advanceTimer) clearTimeout(this.advanceTimer);
    if (this.reopenTimer) clearTimeout(this.reopenTimer);
    if (this.resyncRetryTimer) clearTimeout(this.resyncRetryTimer);
    if (this.resyncHeartbeat) clearInterval(this.resyncHeartbeat);
    if (this.touchHeartbeat) clearInterval(this.touchHeartbeat);
    this.advanceTimer = null;
    this.reopenTimer = null;
    this.resyncRetryTimer = null;
    this.resyncHeartbeat = null;
    this.touchHeartbeat = null;
    this.advanceKey = null;
    this.resyncBackoff.reset();
    this.reopenBackoff.reset();
  }
}
