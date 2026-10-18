import { beforeEach, describe, expect, it } from "vitest";
import { GENRES } from "@/lib/game/genres";
import { createTestDb, createUser, rpc, rpcError, type TestDb } from "./harness";

type Room = { id: string; genre: string };

let db: TestDb;

beforeEach(async () => {
  db = await createTestDb();
});

const roomGenre = async (userId: string, roomId: string) =>
  (await rpc<{ room: Room }>(db, userId, "get_room_snapshot", { p_room_id: roomId })).room.genre;

describe("room genre", () => {
  it("matches the client list in order", async () => {
    const { rows } = await db.query<{ genres: string[] }>("select public.room_genres() as genres");
    expect(rows[0].genres).toEqual(GENRES.map((g) => g.slug));
  });

  it("defaults to all and accepts any listed genre on create", async () => {
    const [a, b] = [await createUser(db), await createUser(db)];
    const plain = await rpc<{ room_id: string }>(db, a, "create_room", { p_mode: "creative" });
    expect(await roomGenre(a, plain.room_id)).toBe("all");
    const drill = await rpc<{ room_id: string }>(db, b, "create_room", { p_mode: "classic", p_genre: "drill" });
    expect(await roomGenre(b, drill.room_id)).toBe("drill");
  });

  it("rejects unknown genres", async () => {
    const a = await createUser(db);
    for (const bad of ["jazz", "Hip-Hop", "", null]) {
      expect(await rpcError(db, a, "create_room", { p_mode: "creative", p_genre: bad }), String(bad)).toBe("invalid_genre");
    }
    expect(await rpcError(db, a, "quick_match", { p_mode: "creative", p_genre: "polka" })).toBe("invalid_genre");
    const room = await rpc<{ room_id: string }>(db, a, "create_room", { p_mode: "creative" });
    expect(await rpcError(db, a, "update_room_settings", { p_room_id: room.room_id, p_genre: "jazz" })).toBe("invalid_genre");
    await expect(db.query("update public.rooms set genre = 'jazz' where id = $1", [room.room_id])).rejects.toThrow(/rooms_genre_valid/);
  });

  it("is a host-only lobby setting that keeps everyone ready", async () => {
    const [host, guest] = [await createUser(db), await createUser(db)];
    const room = await rpc<{ room_id: string; code: string }>(db, host, "create_room", { p_mode: "creative" });
    await rpc(db, guest, "join_room", { p_code: room.code });
    await rpc(db, guest, "set_ready", { p_room_id: room.room_id, p_ready: true });

    expect(await rpcError(db, guest, "update_room_settings", { p_room_id: room.room_id, p_genre: "trap" })).toBe("not_host");
    await rpc(db, host, "update_room_settings", { p_room_id: room.room_id, p_genre: "trap" });
    expect(await roomGenre(guest, room.room_id)).toBe("trap");
    await rpc(db, host, "update_room_settings", { p_room_id: room.room_id, p_name: "Late night" });
    expect(await roomGenre(guest, room.room_id)).toBe("trap");
    const { rows } = await db.query<{ is_ready: boolean }>("select is_ready from public.room_players where user_id = $1", [guest]);
    expect(rows[0].is_ready).toBe(true);

    await rpc(db, host, "start_game", { p_room_id: room.room_id, p_force: true });
    expect(await rpcError(db, host, "update_room_settings", { p_room_id: room.room_id, p_genre: "pop" })).toBe("wrong_phase");
  });

  it("shows in the public room list", async () => {
    const [host, viewer] = [await createUser(db), await createUser(db)];
    const room = await rpc<{ room_id: string }>(db, host, "create_room", { p_mode: "creative", p_genre: "lofi" });
    const listed = await rpc<Room[]>(db, viewer, "list_public_rooms");
    expect(listed.find((r) => r.id === room.room_id)?.genre).toBe("lofi");
  });
});

describe("quick match by genre", () => {
  async function openRoom(genre: string) {
    const host = await createUser(db);
    const room = await rpc<{ room_id: string }>(db, host, "create_room", { p_mode: "creative", p_genre: genre });
    return room.room_id;
  }
  const match = async (genre?: string) =>
    rpc<{ room_id: string; created: boolean }>(db, await createUser(db), "quick_match", { p_mode: "creative", ...(genre ? { p_genre: genre } : {}) });

  it("prefers the exact genre, then open rooms, and never other genres", async () => {
    const house = await openRoom("house");
    const open = await openRoom("all");
    const trap = await openRoom("trap");
    expect((await match("trap")).room_id).toBe(trap);
    expect((await match("drill")).room_id).toBe(open);
    const created = await match("edm");
    expect(created.room_id).not.toBe(house);
    await db.query("update public.rooms set max_players = 2 where id = $1", [open]);
    const fresh = await match("dnb");
    expect(fresh.created).toBe(true);
    const { rows } = await db.query<{ genre: string }>("select genre from public.rooms where id = $1", [fresh.room_id]);
    expect(rows[0].genre).toBe("dnb");
  });

  it("matches any room when looking for all genres", async () => {
    const house = await openRoom("house");
    expect((await match()).room_id).toBe(house);
    expect((await match("all")).room_id).toBe(house);
  });
});
