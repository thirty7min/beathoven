"use client";

import { SendHorizontal } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/components/ui/cn";
import { continuesRun, isEmojiOnly } from "@/lib/game/chat";
import { isSystemMessage } from "@/lib/game/kick";
import type { ChatMessage, RoomPlayer } from "@/lib/game/types";
import { ProfileCard } from "./profile-card";
import { useRoomAction } from "./use-room-action";

const MAX_LENGTH = 500;

export const QUICK_REACTIONS = ["🔥", "💀", "❤️", "👋", "🎵"];

export function ChatPanel({
  messages,
  me,
  hostId,
  players,
  online,
  onSend,
  className,
  autoFocus,
}: {
  messages: ChatMessage[];
  me: string;
  players: RoomPlayer[];
  online: string[];
  hostId: string | null;
  onSend: (body: string) => Promise<unknown>;
  className?: string;
  autoFocus?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const { pending, run } = useRoomAction();
  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const [selected, setSelected] = useState<RoomPlayer | null>(null);
  const playerById = new Map(players.map((p) => [p.user_id, p]));

  useLayoutEffect(() => {
    const list = listRef.current;
    if (list && stickToBottom.current) list.scrollTop = list.scrollHeight;
  }, [messages.length]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const onScroll = () => {
      stickToBottom.current = list.scrollHeight - list.scrollTop - list.clientHeight < 48;
    };
    list.addEventListener("scroll", onScroll, { passive: true });
    return () => list.removeEventListener("scroll", onScroll);
  }, []);

  async function react(emoji: string) {
    if (pending) return;
    stickToBottom.current = true;
    await run("react", () => onSend(emoji));
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const body = draft.trim();
    if (!body || pending) return;
    stickToBottom.current = true;
    const result = await run("send", () => onSend(body));
    if (result !== undefined) setDraft("");
  }

  return (
    <section className={cn("flex min-h-0 flex-col", className)} aria-label="Chat">
      <div ref={listRef} className="scrollbar-thin flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-3" aria-live="polite">
        {messages.length === 0 ? (
          <p className="m-auto text-center text-xs text-muted">No messages yet.</p>
        ) : (
          messages.map((m, i) => {
            if (isSystemMessage(m)) {
              return (
                <p key={m.id} className="mt-2.5 px-4 text-center text-xs text-subtle first:mt-0">
                  {m.body}
                </p>
              );
            }
            const grouped = continuesRun(messages[i - 1], m);
            const mine = m.user_id === me;
            const name = m.username ?? "Unknown player";
            const sender = m.user_id ? (playerById.get(m.user_id) ?? null) : null;
            const openProfile = sender ? () => setSelected(sender) : undefined;
            return (
              <div key={m.id} className={cn("flex items-start gap-2.5", grouped ? "mt-0.5" : "mt-3 first:mt-0")}>
                {grouped ? (
                  <span aria-hidden className="w-6 shrink-0" />
                ) : (
                  <button type="button" onClick={openProfile} disabled={!sender} aria-label={`View ${name}'s profile`} className="mt-0.5 shrink-0 rounded-full">
                    <Avatar name={name} url={sender?.avatar_url} seed={m.user_id ?? name} size="xs" />
                  </button>
                )}
                <div className="flex min-w-0 flex-1 flex-col items-start">
                  {!grouped && (
                    <span className="mb-0.5 flex items-baseline gap-1.5 text-[11px] text-subtle">
                      <button
                        type="button"
                        onClick={openProfile}
                        disabled={!sender}
                        className={cn("font-semibold enabled:hover:underline", m.user_id === hostId || mine ? "text-fg" : "text-muted")}
                      >
                        {name}
                      </button>
                      {mine && <span className="text-subtle">You</span>}
                      <time dateTime={m.created_at}>{new Date(m.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time>
                    </span>
                  )}
                  {isEmojiOnly(m.body) ? (
                    <p className="text-3xl leading-none">{m.body}</p>
                  ) : (
                    <p className="max-w-full text-sm leading-snug break-words whitespace-pre-wrap text-fg">{m.body}</p>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
      <div className="flex flex-col gap-2.5 border-t border-line p-3">
        <form onSubmit={onSubmit} className="flex items-center gap-2">
          <input
            aria-label="Message"
            value={draft}
            maxLength={MAX_LENGTH}
            autoFocus={autoFocus}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Send a message"
            className="h-10 min-w-0 flex-1 rounded-full border border-line-strong bg-transparent px-4 text-sm placeholder:text-muted focus:border-fg/60 focus:outline-none"
          />
          <button
            type="submit"
            disabled={!draft.trim() || pending !== null}
            className="flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-fg px-4 text-sm font-semibold text-page transition hover:bg-white/85 disabled:opacity-30"
          >
            Send
            <SendHorizontal className="h-3.5 w-3.5" />
          </button>
        </form>
        <div className="flex gap-1.5" role="group" aria-label="Quick reactions">
          {QUICK_REACTIONS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => void react(emoji)}
              disabled={pending !== null}
              aria-label={`Send ${emoji}`}
              className="flex h-9 flex-1 items-center justify-center rounded-lg bg-raised text-lg transition hover:bg-hover disabled:opacity-40"
            >
              {emoji}
            </button>
          ))}
        </div>
      </div>
      <ProfileCard
        player={selected}
        isHost={selected?.user_id === hostId}
        online={selected ? selected.is_bot === true || online.includes(selected.user_id) : false}
        onClose={() => setSelected(null)}
      />
    </section>
  );
}
