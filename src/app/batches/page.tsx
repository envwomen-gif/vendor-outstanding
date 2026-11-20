import { getDb } from "@/db";
import { formatInr } from "@/lib/format";
import { listBatches } from "@/lib/queries";

export default async function BatchesPage() {
  const batches = await listBatches(getDb());
  return (
    <>
      <h1>Batches</h1>
      <table>
        <thead><tr><th>Made</th><th>File</th><th className="num">Bank lines</th><th className="num">Bills</th><th className="num">Total</th><th>Status</th><th /></tr></thead>
        <tbody>
          {batches.map((b) => (
            <tr key={b.id}>
              <td>{b.createdAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</td>
              <td><a href={`/batches/${b.id}`}>{b.fileName}</a></td>
              <td className="num">{b.lineCount}</td><td className="num">{b.billCount}</td><td className="num">{formatInr(b.totalPaise)}</td>
              <td>{b.status === "voided" ? <span className="tag bad">Void</span> : "Active"}</td>
              <td><a className="button" href={`/batches/${b.id}/csv`}>Download</a></td>
            </tr>
          ))}
        </tbody>
      </table>
      {batches.length === 0 ? <p className="muted">No batch yet.</p> : null}
    </>
  );
}
