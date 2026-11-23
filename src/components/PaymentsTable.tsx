"use client";

import { type KeyboardEvent, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createBatchAction, previewBatchAction } from "@/app/actions";
import { parseRupeesToPaise } from "@/lib/bank-csv";
import type { Evaluation, Selection } from "@/lib/batch/evaluate";
import { formatDisplayDate, formatInr } from "@/lib/format";
import type { OpenBillRow } from "@/lib/queries";

interface RowState {
  paid: boolean;
  /** Rupees as the person typed them. */
  amount: string;
  /** The chosen bank account, when the party has more than one. */
  bankKey: string | undefined;
  /** A date for this bill only. When it is empty, the bill follows the default date. */
  paidDate: string | undefined;
}

type Filter = "all" | "overdue" | "attention";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "overdue", label: "Overdue" },
  { id: "attention", label: "Needs a bank account" },
];

function rupeesText(paise: number): string {
  return (paise / 100).toFixed(2).replace(/\.00$/, "");
}

/** A bill needs the person to look at the bank account: no account, a bad account, or no choice yet. */
function needsAttention(b: OpenBillRow): boolean {
  return b.bank.status === "unmapped" || b.bank.status === "invalid" || (b.bank.status === "choose" && b.bank.defaultKey === undefined);
}

function BankCell({ bill, value, onChange }: { bill: OpenBillRow; value: string | undefined; onChange: (key: string | undefined) => void }) {
  const { bank } = bill;
  if (bank.status === "unmapped") return <span className="badge bad">Not in Bene Master</span>;
  if (bank.status === "invalid") return <span className="badge bad">Check bank details</span>;
  if (bank.status === "ok") {
    const only = bank.options[0];
    return (
      <span className="bank-ok" title={only?.accountName}>
        {only?.ifsc} <span className="muted">····{only?.last4}</span>
      </span>
    );
  }
  return (
    <select
      className={value === undefined ? "needs-choice" : undefined}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)}
      aria-label={`Bank account for ${bill.account} ${bill.docNo}`}
    >
      <option value="">Choose account ({bank.options.length})</option>
      {bank.options.map((o) => (
        <option key={o.key} value={o.key} disabled={o.problems.length > 0}>
          {o.accountName} · {o.ifsc} ····{o.last4}
          {o.problems.length > 0 ? " (check details)" : ""}
        </option>
      ))}
    </select>
  );
}

function PartyCheckbox({ checked, indeterminate, onChange, label }: { checked: boolean; indeterminate: boolean; onChange: (checked: boolean) => void; label: string }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return <input ref={ref} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-label={label} />;
}

export function PaymentsTable({ bills, today }: { bills: OpenBillRow[]; today: string }) {
  const [state, setState] = useState<Record<string, RowState>>({});
  const [defaultDate, setDefaultDate] = useState(today);
  const [bulkDate, setBulkDate] = useState(today);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [panelOpen, setPanelOpen] = useState(false);
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [error, setError] = useState<{ message: string; details?: string[] } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  function rowState(b: OpenBillRow): RowState {
    return state[b.id] ?? { paid: false, amount: rupeesText(b.balancePaise), bankKey: b.bank.defaultKey, paidDate: undefined };
  }
  function update(b: OpenBillRow, patch: Partial<RowState>) {
    setEvaluation(null);
    setState((prev) => ({ ...prev, [b.id]: { ...rowState(b), ...patch } }));
  }
  const dateOf = (s: RowState) => s.paidDate ?? defaultDate;

  // ----- groups -----
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return bills.filter((b) => {
      if (q !== "" && !b.account.toLowerCase().includes(q) && !b.docNo.toLowerCase().includes(q) && !b.refNo.toLowerCase().includes(q)) return false;
      if (filter === "overdue") return b.overdueDays > 0;
      if (filter === "attention") return needsAttention(b);
      return true;
    });
  }, [bills, search, filter]);

  const parties = useMemo(() => {
    const map = new Map<string, OpenBillRow[]>();
    for (const b of visible) map.set(b.account, [...(map.get(b.account) ?? []), b]);
    return [...map.entries()].map(([account, rows]) => ({
      account,
      rows,
      balancePaise: rows.reduce((sum, r) => sum + r.balancePaise, 0),
    }));
  }, [visible]);

  // ----- totals of the ticked bills -----
  const ticked = bills.filter((b) => state[b.id]?.paid);
  const hiddenTicked = ticked.filter((b) => !visible.includes(b)).length;
  const tickedTotalPaise = ticked.reduce((sum, b) => {
    try {
      return sum + parseRupeesToPaise(rowState(b).amount);
    } catch {
      return sum;
    }
  }, 0);
  const dateCount = new Set(ticked.map((b) => dateOf(rowState(b)))).size;

  // ----- actions -----
  function setParty(rows: OpenBillRow[], paid: boolean) {
    setEvaluation(null);
    setState((prev) => {
      const next = { ...prev };
      for (const b of rows) next[b.id] = { ...(prev[b.id] ?? rowState(b)), paid };
      return next;
    });
  }

  function applyBulkDate() {
    if (bulkDate === "" || ticked.length === 0) return;
    setEvaluation(null);
    setState((prev) => {
      const next = { ...prev };
      for (const b of ticked) next[b.id] = { ...(prev[b.id] ?? rowState(b)), paidDate: bulkDate };
      return next;
    });
    setNotice(`Date ${formatDisplayDate(bulkDate)} is set for ${ticked.length} ticked ${ticked.length === 1 ? "bill" : "bills"}.`);
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
      selections.push({ billId: b.id, amountPaise, paidDate: dateOf(s), ...(s.bankKey ? { bankKey: s.bankKey } : {}) });
    }
    return selections;
  }

  function review() {
    setError(null);
    setNotice(null);
    const selections = collect();
    if (!selections) return;
    setEvaluation(null);
    setPanelOpen(true);
    start(async () => {
      const result = await previewBatchAction(selections);
      if (result.ok) setEvaluation(result.data);
      else {
        setPanelOpen(false);
        setError(result);
      }
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
        setPanelOpen(false);
        setError(result);
      }
    });
  }

  // ----- keyboard -----
  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape" && panelOpen) setPanelOpen(false);
      const target = e.target as HTMLElement | null;
      const typing = target !== null && (target.tagName === "INPUT" || target.tagName === "SELECT" || target.tagName === "TEXTAREA");
      if (e.key === "/" && !typing && !panelOpen) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panelOpen]);

  useEffect(() => {
    if (panelOpen) panelRef.current?.focus();
  }, [panelOpen]);

  function onListKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const target = e.target as HTMLElement;
    if (!(target instanceof HTMLInputElement) || target.type !== "checkbox") return;
    const boxes = [...(listRef.current?.querySelectorAll<HTMLInputElement>("input[data-row-check]") ?? [])];
    const index = boxes.indexOf(target);
    const next = boxes[index + (e.key === "ArrowDown" ? 1 : -1)];
    if (next) {
      e.preventDefault();
      next.focus();
    }
  }

  const blocked = evaluation !== null && !evaluation.canCreate;

  return (
    <>
      <div className="toolbar">
        <input
          ref={searchRef}
          type="search"
          placeholder="Search party, bill or ref no   ( / )"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search party, bill or ref no"
          className="search"
        />
        <div className="chips" role="group" aria-label="Filter bills">
          {FILTERS.map((f) => (
            <button key={f.id} type="button" className="chip" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
              {f.label}
              {f.id === "attention" ? <span className="count">{bills.filter(needsAttention).length}</span> : null}
              {f.id === "overdue" ? <span className="count">{bills.filter((b) => b.overdueDays > 0).length}</span> : null}
            </button>
          ))}
        </div>
        <label className="field">
          <span className="muted">Default paid date</span>
          <input type="date" value={defaultDate} onChange={(e) => { setEvaluation(null); setDefaultDate(e.target.value); }} />
        </label>
      </div>

      {error ? (
        <div className="issue block" role="alert">
          <strong>{error.message}</strong>
          {error.details?.map((d) => <div key={d}>{d}</div>)}
        </div>
      ) : null}
      {notice ? <div className="issue suggestion" role="status">{notice}</div> : null}

      <div ref={listRef} onKeyDown={onListKey} className="parties">
        {parties.map((p) => {
          const tickedHere = p.rows.filter((r) => state[r.id]?.paid).length;
          const isCollapsed = collapsed.has(p.account);
          return (
            <section key={p.account} className="party">
              <header className="party-head">
                <PartyCheckbox
                  checked={tickedHere === p.rows.length}
                  indeterminate={tickedHere > 0 && tickedHere < p.rows.length}
                  onChange={(checked) => setParty(p.rows, checked)}
                  label={`Tick all bills of ${p.account}`}
                />
                <button
                  type="button"
                  className="party-name"
                  aria-expanded={!isCollapsed}
                  onClick={() => setCollapsed((prev) => { const next = new Set(prev); if (next.has(p.account)) next.delete(p.account); else next.add(p.account); return next; })}
                >
                  <span className="chev" aria-hidden="true">{isCollapsed ? "▸" : "▾"}</span> {p.account}
                </button>
                <span className="muted">{p.rows.length} {p.rows.length === 1 ? "bill" : "bills"} · {formatInr(p.balancePaise)}</span>
              </header>
              {isCollapsed ? null : (
                <ul className="bills">
                  {p.rows.map((b) => {
                    const s = rowState(b);
                    return (
                      <li key={b.id} className={`bill${s.paid ? " selected" : ""}`}>
                        <input
                          data-row-check
                          type="checkbox"
                          checked={s.paid}
                          onChange={(e) => update(b, { paid: e.target.checked })}
                          aria-label={`Paid: ${b.account} ${b.docNo}`}
                        />
                        <div className="doc">
                          <strong>{b.docNo}</strong>
                          {b.refNo ? <span className="muted"> · Ref {b.refNo}</span> : null}
                        </div>
                        <div className="due">
                          {formatDisplayDate(b.dueDate)}
                          {b.overdueDays > 0 ? <span className="badge warn">{b.overdueDays} days late</span> : <span className="badge">Not due</span>}
                        </div>
                        <div className="num balance" title={`Adjusted ${formatInr(b.adjustedPaise)}`}>{formatInr(b.balancePaise)}</div>
                        <div className="pay">
                          {s.paid ? (
                            <>
                              <input
                                className="amount"
                                inputMode="decimal"
                                value={s.amount}
                                onChange={(e) => update(b, { amount: e.target.value })}
                                aria-label={`Amount: ${b.account} ${b.docNo}`}
                              />
                              <input
                                type="date"
                                value={dateOf(s)}
                                className={s.paidDate !== undefined && s.paidDate !== defaultDate ? "custom-date" : undefined}
                                onChange={(e) => update(b, { paidDate: e.target.value === "" ? undefined : e.target.value })}
                                aria-label={`Paid date: ${b.account} ${b.docNo}`}
                              />
                            </>
                          ) : (
                            <span className="muted">Tick to pay</span>
                          )}
                        </div>
                        <div className="bank">
                          <BankCell bill={b} value={s.bankKey} onChange={(bankKey) => update(b, { bankKey })} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}
        {parties.length === 0 ? (
          <p className="empty">{bills.length === 0 ? "No open bills. Import the outstanding bills first." : "No bill matches this search or filter."}</p>
        ) : null}
      </div>

      <div className="bar" role="region" aria-label="Selected bills">
        <div className="bar-sum" aria-live="polite">
          <strong>{ticked.length}</strong> {ticked.length === 1 ? "bill" : "bills"} ticked · <strong>{formatInr(tickedTotalPaise)}</strong>
          {ticked.length > 0 ? <span className="muted"> · {dateCount} {dateCount === 1 ? "date" : "dates"}</span> : null}
          {hiddenTicked > 0 ? <span className="muted"> · {hiddenTicked} hidden by the filter</span> : null}
        </div>
        <div className="bar-actions">
          <label className="field">
            <span className="muted">Date for ticked bills</span>
            <input type="date" value={bulkDate} onChange={(e) => setBulkDate(e.target.value)} disabled={ticked.length === 0} />
          </label>
          <button type="button" disabled={ticked.length === 0 || bulkDate === ""} onClick={applyBulkDate}>Set date</button>
          <button type="button" className="primary" disabled={pending || ticked.length === 0} onClick={review}>
            Review and make CSV
          </button>
        </div>
      </div>

      {panelOpen ? (
        <>
          <div className="backdrop" onClick={() => setPanelOpen(false)} aria-hidden="true" />
          <div className="panel" role="dialog" aria-modal="true" aria-labelledby="review-title" ref={panelRef} tabIndex={-1}>
            <div className="panel-head">
              <h2 id="review-title">Review the bank file</h2>
              <button type="button" onClick={() => setPanelOpen(false)}>Close</button>
            </div>
            <div className="panel-body">
              {evaluation === null ? <p className="muted" role="status">Checking…</p> : null}
              {evaluation && evaluation.lines.length > 0 ? (
                <table>
                  <thead><tr><th>Paid date</th><th>Bank account</th><th>Bills</th><th className="num">Amount</th></tr></thead>
                  <tbody>
                    {evaluation.lines.map((l) => (
                      <tr key={`${l.paidDate}${l.accountName}${l.ifsc}${l.accountLast4}`}>
                        <td>{formatDisplayDate(l.paidDate)}</td>
                        <td>
                          {l.accountName}
                          <div className="muted small">{l.ifsc} ····{l.accountLast4}</div>
                          {l.refNos.length ? <div className="muted small">BN {l.refNos.join(", ")}</div> : null}
                        </td>
                        <td>{l.billCount}</td>
                        <td className="num">{formatInr(l.amountPaise)}</td>
                      </tr>
                    ))}
                    <tr>
                      <td colSpan={3}><strong>Total ({evaluation.lines.length} bank {evaluation.lines.length === 1 ? "line" : "lines"})</strong></td>
                      <td className="num"><strong>{formatInr(evaluation.totalPaise)}</strong></td>
                    </tr>
                  </tbody>
                </table>
              ) : null}
              {evaluation?.issues.map((i, n) => (
                <div key={`${i.code}${i.billId ?? ""}${n}`} className={`issue ${i.severity}`}>
                  <strong>{i.severity === "block" ? "Problem: " : i.severity === "warning" ? "Check: " : "Suggestion: "}</strong>
                  {i.message}
                </div>
              ))}
              {evaluation ? (
                evaluation.canCreate ? <p className="ok">No problem blocks this file. Press the button to make it.</p> : <p className="bad">Fix the problems first. Close this panel and change the bills.</p>
              ) : null}
            </div>
            <div className="panel-foot">
              <button type="button" onClick={() => setPanelOpen(false)}>Back to the bills</button>
              <button type="button" className="primary" disabled={pending || evaluation === null || blocked} onClick={done}>
                {pending && evaluation !== null ? "Making the file…" : "Make the bank CSV"}
              </button>
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}
