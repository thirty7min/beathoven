import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { asUser, createTestDb, createUser, rpc, rpcError, type TestDb } from "./harness";

let db: TestDb;

beforeEach(async () => {
  db = await createTestDb();
});

const profile = async (id: string) =>
  (await db.query<{ username: string; display_name: string; bio: string; daws: string[]; onboarded_at: string | null }>(
    "select username, display_name, bio, daws, onboarded_at from public.profiles where id = $1",
    [id],
  )).rows[0];

const onboard = (userId: string, args: Partial<Record<"p_display_name" | "p_username" | "p_bio", string>> & { p_daws?: string[] }) =>
  rpc(db, userId, "complete_onboarding", { p_display_name: "Lo Fi Larry", p_username: "lofi_larry", p_bio: "", p_daws: [], ...args });

const onboardError = (userId: string, args: Parameters<typeof onboard>[1]) =>
  rpcError(db, userId, "complete_onboarding", { p_display_name: "Lo Fi Larry", p_username: "lofi_larry", p_bio: "", p_daws: [], ...args });

describe("display names", () => {
  it("default to the username for new profiles and need onboarding", async () => {
    const user = await createUser(db);
    const p = await profile(user);
    expect(p.display_name).toBe(p.username);
    expect(p.onboarded_at).toBeNull();
  });

  it("are editable directly with the same validation", async () => {
    const user = await createUser(db);
    const update = (name: string) =>
      asUser(db, user, (tx) => tx.query("update public.profiles set display_name = $1 where id = $2", [name, user]));
    await update("DJ Ünïcødé 🎧");
    expect((await profile(user)).display_name).toBe("DJ Ünïcødé 🎧");
    await update("👨‍👩‍👧 crew");
    for (const bad of ["", " padded ", "x".repeat(33), "tab\there", "bidi‮evil", "zero​width"]) {
      await expect(update(bad), JSON.stringify(bad)).rejects.toThrow(/profiles_display_name_valid/);
    }
    expect((await profile(user)).display_name).toBe("👨‍👩‍👧 crew");
  });
});

describe("complete_onboarding", () => {
  it("sets everything in one go", async () => {
    const user = await createUser(db);
    expect(
      await onboard(user, { p_display_name: "  Lo   Fi  Larry ", p_username: "Lofi_Larry", p_bio: " beats ", p_daws: ["reaper", "mpc"] }),
    ).toEqual({ id: user, display_name: "Lo Fi Larry", username: "Lofi_Larry", bio: "beats", daws: ["reaper", "mpc"] });
    const p = await profile(user);
    expect(p).toMatchObject({ display_name: "Lo Fi Larry", username: "Lofi_Larry", bio: "beats", daws: ["reaper", "mpc"] });
    expect(p.onboarded_at).not.toBeNull();
  });

  it("validates every field and changes nothing on failure", async () => {
    const user = await createUser(db);
    const before = await profile(user);
    expect(await onboardError(user, { p_display_name: "   " })).toBe("invalid_display_name");
    expect(await onboardError(user, { p_display_name: "x".repeat(33) })).toBe("invalid_display_name");
    expect(await onboardError(user, { p_username: "no spaces" })).toBe("invalid_username");
    expect(await onboardError(user, { p_username: "ab" })).toBe("invalid_username");
    expect(await onboardError(user, { p_bio: "x".repeat(501) })).toBe("invalid_bio");
    expect(await onboardError(user, { p_daws: ["reaper", "reaper"] })).toBe("invalid_daws");
    expect(await onboardError(user, { p_daws: ["a", "b", "c", "d"] })).toBe("invalid_daws");
    expect(await profile(user)).toEqual(before);
  });

  it("reports a taken username case-insensitively, but lets you keep your own", async () => {
    const [a, b] = [await createUser(db), await createUser(db)];
    await onboard(a, { p_username: "TakenName" });
    expect(await onboardError(b, { p_username: "takenname" })).toBe("username_taken");
    expect((await profile(b)).onboarded_at).toBeNull();
    await onboard(a, { p_username: "TakenName", p_display_name: "New Look" });
    expect((await profile(a)).display_name).toBe("New Look");
  });

  it("requires a signed-in caller", async () => {
    expect(await onboardError(null as unknown as string, {})).toBe("not_authenticated");
  });
});

describe("username_available", () => {
  it("checks format and other users only", async () => {
    const [a, b] = [await createUser(db), await createUser(db)];
    await onboard(a, { p_username: "beatsmith" });
    const available = (userId: string, name: string) => rpc<boolean>(db, userId, "username_available", { p_username: name });
    expect(await available(b, "BeatSmith")).toBe(false);
    expect(await available(a, "beatsmith")).toBe(true);
    expect(await available(b, "fresh_name")).toBe(true);
    expect(await available(b, "x")).toBe(false);
    expect(await available(b, "bad name")).toBe(false);
    await expect(
      asUser(db, null, async (tx) => {
        await tx.exec("set local role anon");
        return tx.query("select public.username_available('fresh_name')");
      }),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("backfill", () => {
  it("copies usernames and marks existing non-anonymous accounts onboarded", async () => {
    const testsDir = fileURLToPath(new URL(".", import.meta.url));
    const migrationsDir = join(testsDir, "..", "migrations");
    const fresh = new PGlite();
    await fresh.exec(readFileSync(join(testsDir, "stubs.sql"), "utf8"));
    const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
    const onboarding = files.findIndex((f) => f.endsWith("_onboarding.sql"));
    for (const file of files.slice(0, onboarding)) await fresh.exec(readFileSync(join(migrationsDir, file), "utf8"));

    const { rows } = await fresh.query<{ id: string; is_anonymous: boolean }>(
      "insert into auth.users (is_anonymous) values (false), (true) returning id, is_anonymous",
    );
    await fresh.exec(readFileSync(join(migrationsDir, files[onboarding]), "utf8"));

    const after = await fresh.query<{ id: string; username: string; display_name: string; onboarded_at: string | null }>(
      "select id, username, display_name, onboarded_at from public.profiles",
    );
    for (const row of after.rows) expect(row.display_name).toBe(row.username);
    const google = rows.find((r) => !r.is_anonymous)!;
    const guest = rows.find((r) => r.is_anonymous)!;
    expect(after.rows.find((r) => r.id === google.id)!.onboarded_at).not.toBeNull();
    expect(after.rows.find((r) => r.id === guest.id)!.onboarded_at).toBeNull();
    await fresh.close();
  });
});

describe("display names shown to others", () => {
  it("appear in room players, chat, system messages, room lists and profiles", async () => {
    const [host, guest, viewer] = [await createUser(db), await createUser(db), await createUser(db)];
    await onboard(host, { p_username: "host_handle", p_display_name: "The Host ✨" });
    await onboard(guest, { p_username: "guest_handle", p_display_name: "Guest Star" });
    const room = await rpc<{ room_id: string; code: string }>(db, host, "create_room", { p_mode: "creative" });
    await rpc(db, guest, "join_room", { p_code: room.code });
    await rpc(db, guest, "send_chat", { p_room_id: room.room_id, p_body: "yo" });
    await rpc(db, host, "kick_player", { p_room_id: room.room_id, p_user_id: guest });

    type Snap = {
      players: { user_id: string; username: string; display_name: string }[];
      chat: { user_id: string | null; username: string | null; display_name: string | null; body: string; kind: string }[];
    };
    const s = await rpc<Snap>(db, host, "get_room_snapshot", { p_room_id: room.room_id });
    expect(s.players.find((p) => p.user_id === host)).toMatchObject({ username: "host_handle", display_name: "The Host ✨" });
    expect(s.chat.find((m) => m.body === "yo")).toMatchObject({ username: "guest_handle", display_name: "Guest Star" });
    expect(s.chat.find((m) => m.kind === "system")!.body).toContain("Guest Star");

    const { rows } = await db.query<{ payload: { body: string; display_name: string } }>(
      "select payload from realtime.messages where event = 'chat' order by id",
    );
    expect(rows.find((r) => r.payload.body === "yo")!.payload.display_name).toBe("Guest Star");

    const listed = await rpc<{ id: string; host_username: string; host_display_name: string }[]>(db, viewer, "list_public_rooms");
    expect(listed.find((r) => r.id === room.room_id)).toMatchObject({ host_username: "host_handle", host_display_name: "The Host ✨" });

    const publicProfile = await rpc<{ profile: { username: string; display_name: string } }>(db, viewer, "get_profile", {
      p_username: "host_handle",
    });
    expect(publicProfile.profile).toMatchObject({ username: "host_handle", display_name: "The Host ✨" });
  });
});
