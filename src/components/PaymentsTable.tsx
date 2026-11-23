"use client";

import { useRouter } from "next/navigation";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createBatchAction, importFromUploadAction, previewBatchAction } from "@/app/actions";
import { parseRupeesToPaise } from "@/lib/bank-csv";
import type { Evaluation, Selection } from "@/lib/batch/evaluate";
import { formatDisplayDate, formatInr } from "@/lib/format";
import type { OpenBillRow } from "@/lib/queries";
import { DateField } from "./DateField";

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
  const [sheetOpen, setSheetOpen] = useState(false);
  const [dueBy, setDueBy] = useState(today);
  const [dragging, setDragging] = useState(false);
  const [importing, setImporting] = useState(false);
  const [rejectedRows, setRejectedRows] = useState<string[]>([]);
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [error, setError] = useState<{ message: string; details?: string[] } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const router = useRouter();
  const [pending, start] = useTransition();
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function rowState(b: OpenBillRow): RowState {
    return state[b.id] ?? { paid: false, amount: rupeesText(b.balancePaise), bankKey: b.bank.defaultKey, paidDate: undefined };
  }
  /** Any change in the bills makes an old check wrong, so the check is closed. */
  function invalidate() {
    setEvaluation(null);
    setSheetOpen(false);
  }
  function update(b: OpenBillRow, patch: Partial<RowState>) {
    invalidate();
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
    invalidate();
    setState((prev) => {
      const next = { ...prev };
      for (const b of rows) next[b.id] = { ...(prev[b.id] ?? rowState(b)), paid };
      return next;
    });
  }

  function applyBulkDate() {
    if (bulkDate === "" || ticked.length === 0) return;
    invalidate();
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

  /** Quick selection. It ticks the bills that match, in the view that the person sees. */
  function tickWhere(match: (b: OpenBillRow) => boolean, what: string) {
    const matching = visible.filter(match);
    const usable = matching.filter((b) => b.bank.status === "ok" || b.bank.status === "choose");
    const needChoice = usable.filter((b) => b.bank.status === "choose" && rowState(b).bankKey === undefined).length;
    invalidate();
    setState((prev) => {
      const next = { ...prev };
      for (const b of usable) next[b.id] = { ...(prev[b.id] ?? rowState(b)), paid: true };
      return next;
    });
    const skipped = matching.length - usable.length;
    setError(null);
    setNotice(
      `${usable.length} ${usable.length === 1 ? "bill" : "bills"} ticked (${what}).` +
        (skipped > 0 ? ` ${skipped} skipped: no usable bank details.` : "") +
        (needChoice > 0 ? ` ${needChoice} need a bank account choice.` : ""),
    );
  }

  function untickAll() {
    invalidate();
    setState({});
    setNotice(null);
  }

  /** Step 1: check the ticked bills on the server. Nothing is saved. */
  function makeFile() {
    setError(null);
    setNotice(null);
    const selections = collect();
    if (!selections) return;
    setEvaluation(null);
    setSheetOpen(true);
    start(async () => {
      const result = await previewBatchAction(selections);
      if (result.ok) setEvaluation(result.data);
      else {
        setSheetOpen(false);
        setError(result);
      }
    });
  }

  /** Step 2: make the batch and download the file. */
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
        setSheetOpen(false);
        setEvaluation(null);
        setError(result);
      }
    });
  }

  // ----- import by drop or by button -----
  async function importFile(file: File) {
    setError(null);
    setRejectedRows([]);
    if (!/\.(xls|xlsx|csv)$/i.test(file.name)) {
      setError({ message: `"${file.name}" is not a JS1 export. Use a .xls, .xlsx or .csv file.` });
      return;
    }
    setImporting(true);
    try {
      const form = new FormData();
      form.set("file", file);
      const result = await importFromUploadAction(form);
      if (result.ok) {
        invalidate();
        setNotice(
          `Replaced the open bills with ${file.name}: ${result.data.billsNew} new, ${result.data.billsUpdated} changed, ${result.data.billsUnchanged} unchanged, ${result.data.billsClosed} removed (not in the file).` +
            (result.data.billsPaidWaiting > 0 ? ` ${result.data.billsPaidWaiting} paid bills stay locked.` : ""),
        );
        setRejectedRows(result.data.rejected.slice(0, 20).map((r) => `${r.account} ${r.docNo}: ${r.reason}`));
        router.refresh();
      } else {
        setError(result);
      }
    } finally {
      setImporting(false);
    }
  }

  // ----- keyboard and drop -----
  // The window listeners are set once. They read the newest functions through this reference.
  const latest = useRef({ makeFile, importFile, canMake: false });
  useEffect(() => {
    latest.current = { makeFile, importFile, canMake: ticked.length > 0 && !pending && !sheetOpen };
  });

  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const typing = tag === "INPUT" ? (target as HTMLInputElement).type !== "checkbox" : tag === "SELECT" || tag === "TEXTAREA";
      if (e.key === "Escape" && sheetOpen) {
        setEvaluation(null);
        setSheetOpen(false);
      } else if (e.key === "/" && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === "Enter" && !typing && tag !== "BUTTON" && tag !== "A" && latest.current.canMake) {
        e.preventDefault();
        latest.current.makeFile();
      }
    }
    function hasFiles(e: DragEvent) {
      return e.dataTransfer?.types.includes("Files") ?? false;
    }
    let depth = 0;
    function onEnter(e: DragEvent) {
      if (!hasFiles(e)) return;
      depth += 1;
      setDragging(true);
    }
    function onLeave(e: DragEvent) {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    }
    function onOver(e: DragEvent) {
      if (hasFiles(e)) e.preventDefault(); // without this the browser opens the file
    }
    function onDrop(e: DragEvent) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const file = e.dataTransfer?.files[0];
      if (file) void latest.current.importFile(file);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("dragover", onOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("drop", onDrop);
    };
  }, [sheetOpen]);

  // When the check is ready, the button to confirm has the focus. Enter or Space then makes the file.
  useEffect(() => {
    if (evaluation?.canCreate && !pending) confirmRef.current?.focus();
  }, [evaluation, pending]);

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
  const blocks = evaluation?.issues.filter((i) => i.severity === "block") ?? [];
  const checks = evaluation?.issues.filter((i) => i.severity === "warning") ?? [];
  const hints = evaluation?.issues.filter((i) => i.severity === "suggestion") ?? [];
  const attentionCount = bills.filter(needsAttention).length;
  const overdueCount = bills.filter((b) => b.overdueDays > 0).length;

  return (
    <>
      {dragging ? (
        <div className="dropzone" aria-hidden="true">
          <div>Drop the JS1 file here to import it</div>
        </div>
      ) : null}

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
              {f.id === "attention" ? <span className="count">{attentionCount}</span> : null}
              {f.id === "overdue" ? <span className="count">{overdueCount}</span> : null}
            </button>
          ))}
        </div>
        <label className="field">
          <span className="muted">Default paid date</span>
          <DateField label="Default paid date" value={defaultDate} onChange={(iso) => { invalidate(); setDefaultDate(iso); }} />
        </label>
        <input
          ref={fileRef}
          type="file"
          accept=".xls,.xlsx,.csv"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = ""; // the same file can be chosen again
            if (file) void importFile(file);
          }}
        />
        <button type="button" disabled={importing} onClick={() => fileRef.current?.click()}>
          {importing ? "Importing…" : "Import JS1 file"}
        </button>
      </div>

      <div className="quick" role="group" aria-label="Quick select">
        <span className="muted">Tick:</span>
        <button type="button" onClick={() => tickWhere((b) => b.dueDate <= today, "due today or earlier")}>Due by today</button>
        <button type="button" onClick={() => tickWhere((b) => b.overdueDays > 0, "overdue")}>Overdue</button>
        <span className="quick-date">
          <DateField label="Tick bills due by" value={dueBy} onChange={setDueBy} />
          <button type="button" onClick={() => tickWhere((b) => b.dueDate <= dueBy, `due by ${formatDisplayDate(dueBy)}`)}>Tick due by this date</button>
        </span>
        <button type="button" disabled={ticked.length === 0} onClick={untickAll}>Untick all</button>
        <span className="muted hint">or drop a JS1 file anywhere on this page</span>
      </div>

      {error ? (
        <div className="issue block" role="alert">
          <strong>{error.message}</strong>
          {error.details?.map((d) => <div key={d}>{d}</div>)}
        </div>
      ) : null}
      {notice ? <div className="issue suggestion" role="status">{notice}</div> : null}
      {rejectedRows.length > 0 ? (
        <div className="issue warning" role="status">
          <strong>Rows that the app could not read:</strong>
          {rejectedRows.map((r) => <div key={r}>{r}</div>)}
        </div>
      ) : null}

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
                              <DateField
                                label={`Paid date: ${b.account} ${b.docNo}`}
                                value={dateOf(s)}
                                className={s.paidDate !== undefined && s.paidDate !== defaultDate ? "custom-date" : undefined}
                                onChange={(iso) => update(b, { paidDate: iso === "" ? undefined : iso })}
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
          <p className="empty">{bills.length === 0 ? "No open bills. Drop the JS1 file on this page to import it." : "No bill matches this search or filter."}</p>
        ) : null}
      </div>

      <div className="bar" role="region" aria-label="Selected bills">
        {sheetOpen ? (
          <div className="sheet" role="status" aria-live="polite">
            {evaluation === null ? <p className="muted">Checking the bills…</p> : null}
            {blocks.map((i, n) => (
              <div key={`b${i.code}${i.billId ?? ""}${n}`} className="issue block"><strong>Problem: </strong>{i.message}</div>
            ))}
            {checks.map((i, n) => (
              <div key={`w${i.code}${i.billId ?? ""}${n}`} className="issue warning"><strong>Check: </strong>{i.message}</div>
            ))}
            {evaluation && evaluation.lines.length > 0 ? (
              <table>
                <thead><tr><th>Paid date</th><th>Bank account</th><th>Bills</th><th className="num">Amount</th></tr></thead>
                <tbody>
                  {evaluation.lines.map((l) => (
                    <tr key={`${l.paidDate}${l.accountName}${l.ifsc}${l.accountLast4}`}>
                      <td>{formatDisplayDate(l.paidDate)}</td>
                      <td>
                        {l.accountName} <span className="muted small">{l.ifsc} ····{l.accountLast4}</span>
                        {l.refNos.length ? <div className="muted small">BN {l.refNos.join(", ")}</div> : null}
                      </td>
                      <td>{l.billCount}</td>
                      <td className="num">{formatInr(l.amountPaise)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
            {hints.length > 0 ? (
              <details className="hints">
                <summary>{hints.length} {hints.length === 1 ? "suggestion" : "suggestions"}</summary>
                {hints.map((i, n) => (
                  <div key={`s${i.code}${i.billId ?? ""}${n}`} className="issue suggestion">{i.message}</div>
                ))}
              </details>
            ) : null}
          </div>
        ) : null}

        <div className="bar-row">
          <div className="bar-sum" aria-live="polite">
            <strong>{ticked.length}</strong> {ticked.length === 1 ? "bill" : "bills"} ticked · <strong>{formatInr(tickedTotalPaise)}</strong>
            {ticked.length > 0 ? <span className="muted"> · {dateCount} {dateCount === 1 ? "date" : "dates"}</span> : null}
            {hiddenTicked > 0 ? <span className="muted"> · {hiddenTicked} hidden by the filter</span> : null}
          </div>
          <div className="bar-actions">
            {sheetOpen ? (
              <>
                <span className={blocked ? "bad" : "ok"}>
                  {evaluation === null
                    ? "Checking…"
                    : blocked
                      ? `${blocks.length} ${blocks.length === 1 ? "problem" : "problems"} to fix`
                      : `${evaluation.lines.length} bank ${evaluation.lines.length === 1 ? "line" : "lines"} · ${formatInr(evaluation.totalPaise)}`}
                </span>
                <button type="button" onClick={() => { setEvaluation(null); setSheetOpen(false); }}>Back</button>
                <button ref={confirmRef} type="button" className="primary" disabled={pending || evaluation === null || blocked} onClick={done}>
                  {pending && evaluation !== null ? "Making the file…" : "Confirm and download"}
                </button>
              </>
            ) : (
              <>
                <label className="field">
                  <span className="muted">Date for ticked bills</span>
                  <DateField label="Date for ticked bills" value={bulkDate} onChange={setBulkDate} disabled={ticked.length === 0} />
                </label>
                <button type="button" disabled={ticked.length === 0 || bulkDate === ""} onClick={applyBulkDate}>Set date</button>
                <button type="button" className="primary" disabled={pending || ticked.length === 0} onClick={makeFile}>
                  Make bank CSV
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
