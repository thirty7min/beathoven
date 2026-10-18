import { beforeEach, describe, expect, it } from "vitest";
import { DAWS } from "@/lib/profile/daws";
import { asService, asUser, createTestDb, createUser, rpc, type TestDb } from "./harness";

let db: TestDb;

beforeEach(async () => {
  db = await createTestDb();
});

const setDaws = (userId: string, daws: unknown) =>
  asUser(db, userId, (tx) => tx.query("update public.profiles set daws = $1 where id = $2", [daws, userId]));

const readProfile = async (userId: string) =>
  (await db.query<{ daws: string[]; link_url: string | null; username: string }>(
    "select daws, link_url, username from public.profiles where id = $1",
    [userId],
  )).rows[0];

const serviceCall = <T>(sql: string, params: unknown[] = []) =>
  asService(db, async (tx) => (await tx.query<{ result: T }>(sql, params)).rows[0]?.result);

async function failure(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("expected failure");
}

describe("profile daws", () => {
  it("matches the TypeScript DAW list in order", async () => {
    const { rows } = await db.query<{ daws: string[] }>("select public.allowed_daws() as daws");
    expect(rows[0].daws).toEqual(DAWS.map((d) => d.slug));
  });

  it("defaults to empty and keeps the chosen order", async () => {
    const user = await createUser(db);
    expect((await readProfile(user)).daws).toEqual([]);
    await setDaws(user, ["reaper", "ableton-live", "mpc"]);
    expect((await readProfile(user)).daws).toEqual(["reaper", "ableton-live", "mpc"]);
    await setDaws(user, []);
    expect((await readProfile(user)).daws).toEqual([]);
  });

  it("rejects more than three, duplicates, unknown slugs and nulls", async () => {
    const user = await createUser(db);
    for (const daws of [
      ["reaper", "ableton-live", "mpc", "lmms"],
      ["reaper", "reaper"],
      ["reaper", "notadaw"],
      ["Reaper"],
      ["reaper", null],
    ]) {
      expect(await failure(() => setDaws(user, daws)), JSON.stringify(daws)).toMatch(/profiles_daws_valid/);
    }
    expect(await failure(() => setDaws(user, null))).toMatch(/null/);
  });

  it("only lets users edit their own daws", async () => {
    const [a, b] = [await createUser(db), await createUser(db)];
    await asUser(db, a, (tx) => tx.query("update public.profiles set daws = '{reaper}' where id = $1", [b]));
    expect((await readProfile(b)).daws).toEqual([]);
  });
});

describe("profile link", () => {
  it("can't be written by clients", async () => {
    const user = await createUser(db);
    expect(
      await failure(() =>
        asUser(db, user, (tx) =>
          tx.query("update public.profiles set link_url = 'https://example.com/' where id = $1", [user]),
        ),
      ),
    ).toMatch(/permission denied/);
  });

  it("keeps the link functions service-only", async () => {
    const user = await createUser(db);
    for (const call of [
      "select public.claim_link_attempt($1::uuid)",
      "select public.set_profile_link($1::uuid, 'https://example.com/')",
      "select public.clear_unsafe_link($1::uuid, 'https://example.com/')",
      "select public.get_profile_link($1::text)",
      "select public.link_domain_blocked($1::text)",
      "select public.record_link_check($1::text)",
    ]) {
      expect(await failure(() => asUser(db, user, (tx) => tx.query(call, [user]))), call).toMatch(/permission denied/);
      expect(await failure(() => asUser(db, null, (tx) => tx.query("set local role anon").then(() => tx.query(call, [user]))))).toMatch(
        /permission denied/,
      );
    }
  });

  it("sets, enforces the format and clears via the service role", async () => {
    const user = await createUser(db);
    expect(await serviceCall("select public.set_profile_link($1, 'https://example.com/a') as result", [user])).toBe(
      "https://example.com/a",
    );
    expect((await readProfile(user)).link_url).toBe("https://example.com/a");
    expect(await failure(() => serviceCall("select public.set_profile_link($1, 'http://example.com/') as result", [user]))).toMatch(
      /profiles_link_url_format/,
    );
    expect(
      await failure(() => serviceCall("select public.set_profile_link($1, $2) as result", [user, `https://e.com/${"a".repeat(200)}`])),
    ).toMatch(/profiles_link_url_format/);
    await serviceCall("select public.set_profile_link($1, null) as result", [user]);
    expect((await readProfile(user)).link_url).toBeNull();
  });

  it("rate-limits saves to 10 per hour", async () => {
    const user = await createUser(db);
    for (let i = 0; i < 10; i++) await serviceCall("select public.claim_link_attempt($1) as result", [user]);
    expect(await failure(() => serviceCall("select public.claim_link_attempt($1) as result", [user]))).toMatch(/link_rate_limited/);
    await db.query("update public.profile_link_attempts set created_at = now() - interval '61 minutes' where user_id = $1", [user]);
    await serviceCall("select public.claim_link_attempt($1) as result", [user]);
  });

  it("blocks a domain and its subdomains only", async () => {
    await db.query("insert into public.blocked_domains (domain) values ('evil.com')");
    const blocked = (host: string) => serviceCall<boolean>("select public.link_domain_blocked($1) as result", [host]);
    expect(await blocked("evil.com")).toBe(true);
    expect(await blocked("www.evil.com")).toBe(true);
    expect(await blocked("a.b.EVIL.com.")).toBe(true);
    expect(await blocked("notevil.com")).toBe(false);
    expect(await blocked("evil.com.au")).toBe(false);
    expect(await failure(() => db.query("insert into public.blocked_domains (domain) values ('Evil.org')"))).toMatch(
      /blocked_domains_format/,
    );
  });

  it("caches checks for a day and clears only the matching unsafe link", async () => {
    const user = await createUser(db);
    const { username } = await readProfile(user);
    await serviceCall("select public.set_profile_link($1, 'https://example.com/') as result", [user]);
    const target = () => serviceCall<{ link_url: string | null; checked_recently: boolean; user_id: string }>(
      "select public.get_profile_link($1) as result",
      [username.toUpperCase()],
    );
    expect(await target()).toMatchObject({ user_id: user, link_url: "https://example.com/", checked_recently: false });
    await serviceCall("select public.record_link_check('https://example.com/') as result");
    expect((await target()).checked_recently).toBe(true);
    await db.query("update public.link_checks set checked_at = now() - interval '25 hours'");
    expect((await target()).checked_recently).toBe(false);

    expect(await serviceCall("select public.clear_unsafe_link($1, 'https://other.com/') as result", [user])).toBe(false);
    expect((await readProfile(user)).link_url).toBe("https://example.com/");
    expect(await serviceCall("select public.clear_unsafe_link($1, 'https://example.com/') as result", [user])).toBe(true);
    expect((await readProfile(user)).link_url).toBeNull();
    expect(await serviceCall("select public.get_profile_link('nobody_here') as result")).toBeNull();
  });

  it("returns daws and link_url from get_profile", async () => {
    const user = await createUser(db);
    const { username } = await readProfile(user);
    await setDaws(user, ["fl-studio", "ableton-live"]);
    await serviceCall("select public.set_profile_link($1, 'https://example.com/') as result", [user]);
    const result = await rpc<{ profile: { daws: string[]; link_url: string | null } }>(db, null, "get_profile", {
      p_username: username,
    });
    expect(result.profile.daws).toEqual(["fl-studio", "ableton-live"]);
    expect(result.profile.link_url).toBe("https://example.com/");
  });
});
