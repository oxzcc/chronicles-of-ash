import { createDb } from "@ash/db";
import { getRouter } from "@/lib/server";

export const dynamic = "force-dynamic";

let dbHandle: ReturnType<typeof createDb> | null = null;

export async function GET() {
  let db: "ok" | "down" | "not_configured" = "not_configured";
  if (process.env.DATABASE_URL) {
    try {
      dbHandle ??= createDb();
      await dbHandle.pool.query("select 1");
      db = "ok";
    } catch {
      db = "down";
    }
  }
  return Response.json({ ok: db !== "down", db, llm: getRouter().isFake ? "fake" : "openrouter" });
}
