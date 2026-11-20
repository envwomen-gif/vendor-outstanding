import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { batch } from "@/db/schema";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Gives the saved CSV text, byte for byte. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  if (!UUID.test(id)) return new Response("Not found", { status: 404 });
  const [row] = await getDb().select().from(batch).where(eq(batch.id, id));
  if (!row) return new Response("Not found", { status: 404 });
  return new Response(row.csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${row.fileName}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
