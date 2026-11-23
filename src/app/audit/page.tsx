import { formatDisplayDateTime } from "@/lib/format";
import { getDb } from "@/db";
import { listAudit } from "@/lib/queries";

export default async function AuditPage() {
  const rows = await listAudit(getDb());
  return (
    <>
      <h1>Audit log</h1>
      <table>
        <thead><tr><th>Time</th><th>Action</th><th>Item</th><th>Detail</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{formatDisplayDateTime(r.at)}</td><td>{r.action}</td>
              <td className="muted">{r.entity} {r.entityId.slice(0, 8)}</td>
              <td><code>{JSON.stringify(r.detail)}</code></td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
