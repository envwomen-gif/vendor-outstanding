import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { BatchActions } from "@/components/BatchActions";
import { formatDisplayDate, formatInr } from "@/lib/format";
import { getBatch } from "@/lib/queries";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function BatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ download?: string }>;
}) {
  const { id } = await params;
  const { download } = await searchParams;
  if (!UUID.test(id)) notFound();
  const found = await getBatch(getDb(), id);
  if (!found) notFound();
  const { batch, payments } = found;

  return (
    <>
      <h1>{batch.fileName}</h1>
      <p className="muted">
        {batch.lineCount} bank lines, {batch.billCount} bills, total {formatInr(batch.totalPaise)}. SHA-256: <code>{batch.csvSha256.slice(0, 16)}…</code>
        {batch.status === "voided" ? <> <span className="tag bad">Void: {batch.voidReason}</span></> : null}
      </p>
      <BatchActions batchId={batch.id} voided={batch.status === "voided"} autoDownload={download === "1"} />
      <table>
        <thead><tr><th>Paid date</th><th>Party</th><th>Bill</th><th>Ref no</th><th>IFSC</th><th>Account no</th><th className="num">Amount</th></tr></thead>
        <tbody>
          {payments.map(({ p, account, docNo }) => (
            <tr key={p.id}>
              <td>{formatDisplayDate(p.paidDate)}</td><td>{p.beneficiaryName}<div className="muted">{account}</div></td><td>{docNo}</td>
              <td>{p.refNo}</td><td>{p.ifsc}</td><td>{p.accountNumber}</td><td className="num">{formatInr(p.amountPaise)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
