import { getDb } from "@/db";
import { OverdueSummary } from "@/components/OverdueSummary";
import { PaymentsTable } from "@/components/PaymentsTable";
import { formatInr, todayInIndia } from "@/lib/format";
import { listOpenBills } from "@/lib/queries";

export default async function PaymentsPage() {
  const bills = await listOpenBills(getDb());
  const total = bills.reduce((sum, b) => sum + b.balancePaise, 0);
  const overdue = bills.filter((b) => b.overdueDays > 0);
  const parties = new Set(bills.map((b) => b.account)).size;
  return (
    <>
      <h1>Payments due</h1>
      <div className="summary">
        <div className="stat"><span className="muted">Open bills</span><strong>{bills.length}</strong><span className="muted">{parties} parties</span></div>
        <div className="stat"><span className="muted">Total to pay</span><strong>{formatInr(total)}</strong></div>
        <OverdueSummary
          bills={overdue.map((b) => ({
            id: b.id,
            account: b.account,
            docNo: b.docNo,
            refNo: b.refNo,
            billDate: b.billDate,
            dueDate: b.dueDate,
            overdueDays: b.overdueDays,
            adjustedPaise: b.adjustedPaise,
            balancePaise: b.balancePaise,
          }))}
        />
      </div>
      <p className="muted">
        Bills are in FIFO order: the oldest due date first. Tick the bills that you pay. You can change the amount, the paid date and the bank account of each bill.
        Paid bills are locked and cannot go in a second batch.
      </p>
      <PaymentsTable bills={bills} today={todayInIndia()} />
    </>
  );
}
