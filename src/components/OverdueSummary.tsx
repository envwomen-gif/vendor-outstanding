"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatDisplayDate, formatInr } from "@/lib/format";
import { groupByParty } from "@/lib/party-groups";

export interface OverdueBill {
  id: string;
  account: string;
  docNo: string;
  refNo: string;
  billDate: string;
  dueDate: string;
  overdueDays: number;
  adjustedPaise: number;
  balancePaise: number;
}

/**
 * The Overdue card. A click opens the party-wise table of the overdue bills.
 * It has the same layout as the pivot table in the sheet: one row for each party with the total,
 * and the bills of the party when the row is opened. The bills come in FIFO order.
 */
export function OverdueSummary({ bills }: { bills: OverdueBill[] }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());

  const parties = useMemo(() => groupByParty(bills), [bills]);
  const totalPaise = bills.reduce((sum, b) => sum + b.balancePaise, 0);

  // Close on a click outside the panel. The native dialog already closes on Escape.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const onClick = (e: MouseEvent) => {
      if (e.target === dialog) dialog.close();
    };
    dialog.addEventListener("click", onClick);
    return () => dialog.removeEventListener("click", onClick);
  }, []);

  function toggle(account: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(account)) next.delete(account);
      else next.add(account);
      return next;
    });
  }

  return (
    <>
      <button
        type="button"
        className="stat stat-button"
        disabled={bills.length === 0}
        onClick={() => dialogRef.current?.showModal()}
        aria-haspopup="dialog"
      >
        <span className="muted">Overdue · click for the party-wise table</span>
        <strong className={bills.length > 0 ? "warn-text" : undefined}>{formatInr(totalPaise)}</strong>
        <span className="muted">{bills.length} bills</span>
      </button>

      <dialog ref={dialogRef} className="overdue-dialog" aria-label="Overdue bills, party wise">
        <header className="overdue-head">
          <div>
            <h2>Overdue, party wise</h2>
            <p className="muted">
              {parties.length} {parties.length === 1 ? "party" : "parties"} · {bills.length} bills · <strong>{formatInr(totalPaise)}</strong>. The oldest due date is first.
            </p>
          </div>
          <div className="row">
            <button type="button" onClick={() => setOpen(new Set(parties.map((p) => p.account)))}>Expand all</button>
            <button type="button" onClick={() => setOpen(new Set())}>Collapse all</button>
            <button type="button" className="primary" onClick={() => dialogRef.current?.close()} autoFocus>Close</button>
          </div>
        </header>
        <div className="overdue-scroll">
        <table>
          <thead>
            <tr>
              <th>Party</th><th>Bill date</th><th>Due date</th><th>Doc no</th><th>Ref no</th>
              <th className="num">Days late</th><th className="num">Adjusted</th><th className="num">Balance</th>
            </tr>
          </thead>
          <tbody>
            <tr className="overdue-total">
              <td colSpan={7}><strong>Total</strong></td>
              <td className="num"><strong>{formatInr(totalPaise)}</strong></td>
            </tr>
            {parties.map((p) => {
              const isOpen = open.has(p.account);
              return (
                <PartyRows key={p.account} account={p.account} count={p.rows.length} oldestDue={p.oldestDue} balancePaise={p.balancePaise} rows={p.rows} isOpen={isOpen} onToggle={() => toggle(p.account)} />
              );
            })}
          </tbody>
        </table>
        </div>
      </dialog>
    </>
  );
}

function PartyRows({
  account, count, oldestDue, balancePaise, rows, isOpen, onToggle,
}: {
  account: string;
  count: number;
  oldestDue: string;
  balancePaise: number;
  rows: OverdueBill[];
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr className="overdue-party">
        <td colSpan={2}>
          <button type="button" className="party-name" aria-expanded={isOpen} onClick={onToggle}>
            <span className="chev" aria-hidden="true">{isOpen ? "▾" : "▸"}</span> {account}
          </button>
        </td>
        <td>{formatDisplayDate(oldestDue)}</td>
        <td colSpan={3} className="muted">{count} {count === 1 ? "bill" : "bills"}</td>
        <td />
        <td className="num"><strong>{formatInr(balancePaise)}</strong></td>
      </tr>
      {isOpen
        ? rows.map((b) => (
            <tr key={b.id}>
              <td />
              <td>{formatDisplayDate(b.billDate)}</td>
              <td>{formatDisplayDate(b.dueDate)}</td>
              <td>{b.docNo}</td>
              <td>{b.refNo}</td>
              <td className="num">{b.overdueDays}</td>
              <td className="num">{formatInr(b.adjustedPaise)}</td>
              <td className="num">{formatInr(b.balancePaise)}</td>
            </tr>
          ))
        : null}
    </>
  );
}
