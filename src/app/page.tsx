import { getDb } from "@/db";
import { PaymentsTable } from "@/components/PaymentsTable";
import { todayInIndia } from "@/lib/format";
import { listOpenBills } from "@/lib/queries";

export default async function PaymentsPage() {
  const bills = await listOpenBills(getDb());
  return (
    <>
      <h1>Payments due (FIFO)</h1>
      <p className="muted">
        Tick <strong>Paid</strong> for each bill that you pay. The amount starts as the bill balance. Press <strong>Review</strong>, then <strong>Done</strong> to make the bank CSV.
        Paid bills are locked and cannot go in a second batch.
      </p>
      <PaymentsTable bills={bills} today={todayInIndia()} />
    </>
  );
}
