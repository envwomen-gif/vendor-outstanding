import { getDb } from "@/db";
import { BeneRefresh } from "@/components/BeneRefresh";
import { listBeneWithProblems } from "@/lib/queries";

const TEXT: Record<string, string> = {
  INVALID_IFSC: "IFSC is not valid",
  INVALID_ACCOUNT_NUMBER: "Account number is not valid",
};

export default async function BenePage() {
  const { total, problems, refreshedAt } = await listBeneWithProblems(getDb());
  return (
    <>
      <h1>Bene Master</h1>
      <p className="muted">
        {total} parties in the saved copy. {refreshedAt ? `Last refresh: ${new Date(refreshedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}.` : "Not refreshed yet."}
      </p>
      <BeneRefresh />
      <h2>Rows with problems ({problems.length})</h2>
      <p className="muted">The app blocks a payment to these parties. Correct the row in the Bene Master sheet, then refresh.</p>
      <table>
        <thead><tr><th>Software name</th><th>Account name</th><th>IFSC</th><th>Account no</th><th>Problem</th></tr></thead>
        <tbody>
          {problems.map((r) => (
            <tr key={r.id}>
              <td>{r.softwareName}</td><td>{r.accountName}</td><td>{r.ifsc}</td><td>{r.accountNumber}</td>
              <td className="bad">{r.problems.map((p) => TEXT[p] ?? p).join(", ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
