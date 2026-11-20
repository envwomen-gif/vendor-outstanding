import { getDb } from "@/db";
import { ImportPanel } from "@/components/ImportPanel";
import { lastImport } from "@/lib/queries";

export default async function ImportPage() {
  const last = await lastImport(getDb());
  return (
    <>
      <h1>Import outstanding bills</h1>
      <p className="muted">
        {last
          ? `Last import: ${last.createdAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} (${last.source === "sheet" ? "sheet" : `file ${last.fileName ?? ""}`}).`
          : "No import yet."}
      </p>
      <ImportPanel />
    </>
  );
}
