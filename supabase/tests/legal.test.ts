import { expect, it } from "vitest";
import { SUBMISSION_RETENTION_DAYS } from "@/lib/legal";
import { createTestDb } from "./harness";

it("the privacy policy's audio retention matches the purge rule", async () => {
  const db = await createTestDb();
  const { rows } = await db.query<{ definition: string }>(
    "select pg_get_functiondef('public.submissions_due_for_purge(integer)'::regprocedure) as definition",
  );
  expect(rows[0].definition).toContain(`interval '${SUBMISSION_RETENTION_DAYS} days'`);
});
