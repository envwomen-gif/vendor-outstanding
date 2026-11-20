"use client";

import { useMemo, useState, useTransition } from "react";
import { createBatchAction, previewBatchAction } from "@/app/actions";
import { parseRupeesToPaise } from "@/lib/bank-csv";
import type { Evaluation, Selection } from "@/lib/batch/evaluate";
import { formatDisplayDate, formatInr } from "@/lib/format";
import type { OpenBillRow } from "@/lib/queries";

interface RowState {
  paid: boolean;
  amount: string; // rupees as typed
}

function rupeesText(paise: number): string {
  return (paise / 100).toFixed(2).replace(/\.00$/, "");
}

export function PaymentsTable({ bills, today }: { bills: OpenBillRow[]; today: string }) {
  const [state, setState] = useState<Record<string, RowState>>({});
  const [paidDate, setPaidDate] = useState(today);
  const [filter, setFilter] = useState("");
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [error, setError] = useState<{ message: string; details?: string[] } | null>(null);
  const [pending, start] = useTransition();

  const visible = useMemo(
    () => bills.filter((b) => b.account.toLowerCase().includes(filter.trim().toLowerCase())),
    [bills, filter],
  );
  const selectedCount = Object.values(state).filter((s) => s.paid).length;

  function rowState(b: OpenBillRow): RowState {
    return state[b.id] ?? { paid: false, amount: rupeesText(b.balancePaise) };
  }
  function update(b: OpenBillRow, patch: Partial<RowState>) {
    setEvaluation(null);
    setState((prev) => ({ ...prev, [b.id]: { ...rowState(b), ...patch } }));
  }

  function collect(): Selection[] | null {
    const selections: Selection[] = [];
    for (const b of bills) {
      const s = state[b.id];
      if (!s?.paid) continue;
      let amountPaise: number;
      try {
        amountPaise = parseRupeesToPaise(s.amount);
      } catch {
        setError({ message: `${b.account}, bill ${b.docNo}: the amount "${s.amount}" is not valid. Use numbers, with 2 decimals at most.` });
        return null;
      }
      selections.push({ billId: b.id, amountPaise, paidDate });
    }
    return selections;
  }

  function review() {
    setError(null);
    const selections = collect();
    if (!selections) return;
    start(async () => {
      const result = await previewBatchAction(selections);
      if (result.ok) setEvaluation(result.data);
      else setError(result);
    });
  }

  function done() {
    setError(null);
    const selections = collect();
    if (!selections) return;
    start(async () => {
      const result = await createBatchAction(selections);
      if (result.ok) {
        // Open the batch page. It starts the download of the CSV file.
        window.location.href = `/batches/${result.data.batchId}?download=1`;
      } else {
        setError(result);
      }
    });
  }

  return (
    <>
      <div className="row">
        <label>
          Paid date <input type="date" value={paidDate} onChange={(e) => { setEvaluation(null); setPaidDate(e.target.value); }} />
        </label>
        <input placeholder="Search party…" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Search party" />
        <span className="muted">{selectedCount} selected</span>
        <button disabled={pending || selectedCount === 0} onClick={review}>Review</button>
        <button className="primary" disabled={pending || selectedCount === 0 || (evaluation !== null && !evaluation.canCreate)} onClick={done}>
          Done: make the bank CSV
        </button>
      </div>

      {error ? (
        <div className="issue block" role="alert">
          <strong>{error.message}</strong>
          {error.details?.map((d) => <div key={d}>{d}</div>)}
        </div>
      ) : null}

      {evaluation ? (
        <div className="card" role="status">
          <h2 style={{ marginTop: 0 }}>Review</h2>
          {evaluation.lines.length > 0 ? (
            <table>
              <thead><tr><th>Paid date</th><th>Party (bank account name)</th><th>Bills</th><th>Reference</th><th className="num">Bank line amount</th></tr></thead>
              <tbody>
                {evaluation.lines.map((l) => (
                  <tr key={`${l.paidDate}${l.accountName}`}>
                    <td>{formatDisplayDate(l.paidDate)}</td><td>{l.accountName}</td><td>{l.billCount}</td>
                    <td>{l.refNos.length ? `BN ${l.refNos.join(", ")}` : ""}</td><td className="num">{formatInr(l.amountPaise)}</td>
                  </tr>
                ))}
                <tr><td colSpan={4}><strong>Total ({evaluation.lines.length} bank lines)</strong></td><td className="num"><strong>{formatInr(evaluation.totalPaise)}</strong></td></tr>
              </tbody>
            </table>
          ) : null}
          {evaluation.issues.map((i, n) => (
            <div key={`${i.code}${i.billId ?? ""}${n}`} className={`issue ${i.severity}`}>
              <strong>{i.severity === "block" ? "Problem: " : i.severity === "warning" ? "Check: " : "Suggestion: "}</strong>
              {i.message}
            </div>
          ))}
          {evaluation.canCreate ? <p className="ok">No problem blocks this batch. Press Done to make the file.</p> : <p className="bad">Fix the problems first.</p>}
        </div>
      ) : null}

      <table>
        <thead>
          <tr>
            <th>Paid</th><th>Amount paid (₹)</th><th>Due date</th><th>Party</th><th>Doc no</th><th>Ref no</th>
            <th className="num">Adjusted</th><th className="num">Balance</th><th className="num">Overdue days</th><th>Bank details</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((b) => {
            const s = rowState(b);
            return (
              <tr key={b.id} className={s.paid ? "selected" : undefined}>
                <td><input type="checkbox" checked={s.paid} onChange={(e) => update(b, { paid: e.target.checked })} aria-label={`Paid: ${b.account} ${b.docNo}`} /></td>
                <td><input className="amount" inputMode="decimal" value={s.amount} disabled={!s.paid} onChange={(e) => update(b, { amount: e.target.value })} aria-label={`Amount: ${b.account} ${b.docNo}`} /></td>
                <td>{formatDisplayDate(b.dueDate)}</td>
                <td>{b.account}</td>
                <td>{b.docNo}</td>
                <td>{b.refNo}</td>
                <td className="num">{formatInr(b.adjustedPaise)}</td>
                <td className="num">{formatInr(b.balancePaise)}</td>
                <td className="num">{b.overdueDays}</td>
                <td>
                  {b.bank.status === "ok" ? <span className="ok">OK</span> : null}
                  {b.bank.status === "unmapped" ? <span className="tag bad">Not in Bene Master</span> : null}
                  {b.bank.status === "invalid" ? <span className="tag bad">Check bank details</span> : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {visible.length === 0 ? <p className="muted">No open bills. Import the outstanding bills first.</p> : null}
    </>
  );
}
