import { beforeEach, describe, expect, it } from "vitest";
import { USERNAME_PATTERN } from "@/lib/profile/validate";
import { createTestDb, rpc, type TestDb } from "./harness";

let db: TestDb;

beforeEach(async () => {
  db = await createTestDb();
});

type Profile = { id: string; username: string; display_name: string; onboarded_at: string | null };

async function signUp(anonymous: boolean, metadata: Record<string, unknown> | null = null) {
  const { rows } = await db.query<{ id: string }>(
    "insert into auth.users (is_anonymous, raw_user_meta_data) values ($1, $2) returning id",
    [anonymous, metadata === null ? null : JSON.stringify(metadata)],
  );
  return (
    await db.query<Profile>("select id, username, display_name, onboarded_at from public.profiles where id = $1", [rows[0].id])
  ).rows[0];
}

describe("guest profiles", () => {
  it("use the typed name as the display name and get a random username", async () => {
    const guest = await signUp(true, { display_name: "  DJ   Guest 🎧 " });
    expect(guest.display_name).toBe("DJ Guest 🎧");
    expect(guest.username).toMatch(/^guest_[a-z0-9]{6}$/);
    expect(USERNAME_PATTERN.test(guest.username)).toBe(true);
    expect(guest.onboarded_at).toBeNull();
  });

  it("never take a username from the client", async () => {
    const guest = await signUp(true, { display_name: "Somebody", username: "chosen_name" });
    expect(guest.username).not.toBe("chosen_name");
    expect(guest.username).toMatch(/^guest_/);
  });

  it("fall back to the username when the name is missing or invalid", async () => {
    for (const metadata of [null, {}, { display_name: "   " }, { display_name: "x".repeat(33) }, { display_name: "bidi‮evil" }]) {
      const guest = await signUp(true, metadata);
      expect(guest.display_name, JSON.stringify(metadata)).toBe(guest.username);
    }
  });

  it("get unique usernames", async () => {
    const names = new Set<string>();
    for (let i = 0; i < 40; i++) names.add((await signUp(true, { display_name: "Same Name" })).username.toLowerCase());
    expect(names.size).toBe(40);
  });

  it("leave regular sign-ups as before", async () => {
    const user = await signUp(false, { display_name: "Ignored" });
    expect(user.username).toMatch(/^producer_[0-9a-f]{10}$/);
    expect(user.display_name).toBe(user.username);
  });

  it("show their display name to the room", async () => {
    const host = await signUp(true, { display_name: "Host Guest" });
    const room = await rpc<{ room_id: string }>(db, host.id, "create_room", { p_mode: "creative" });
    const s = await rpc<{ players: { user_id: string; username: string; display_name: string }[] }>(db, host.id, "get_room_snapshot", {
      p_room_id: room.room_id,
    });
    expect(s.players[0]).toMatchObject({ username: host.username, display_name: "Host Guest" });
  });
});
