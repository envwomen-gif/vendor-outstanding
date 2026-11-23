"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createInstantBatchAction } from "@/app/actions";
import { parseRupeesToPaise } from "@/lib/bank-csv";
import { formatDisplayDate, formatInr } from "@/lib/format";
import type { InstantParty } from "@/lib/queries";
import { DateField } from "./DateField";

interface Row {
  id: number;
  party: string;
  bankKey: string | undefined;
  amount: string;
  reference: string;
}

const MAX_ROWS = 50;

function emptyRow(id: number): Row {
  return { id, party: "", bankKey: undefined, amount: "", reference: "" };
}

function paiseOf(text: string): number | undefined {
  if (text.trim() === "") return undefined;
  try {
    const p = parseRupeesToPaise(text.trim());
    return p > 0 ? p : undefined;
  } catch {
    return undefined;
  }
}

export function InstantForm({ parties, today }: { parties: InstantParty[]; today: string }) {
  const [rows, setRows] = useState<Row[]>([emptyRow(1)]);
  const [paidDate, setPaidDate] = useState(today);
  const [review, setReview] = useState(false);
  const [error, setError] = useState<{ message: string; details?: string[] } | null>(null);
  const [pending, start] = useTransition();
  const nextId = useRef(2);
  const confirmRef = useRef<HTMLButtonElement>(null);

  // Names are matched without case, so "abc traders" finds "ABC TRADERS".
  const byName = useMemo(() => new Map(parties.map((p) => [p.name.toLowerCase(), p])), [parties]);
  const partyOf = (row: Row) => byName.get(row.party.trim().toLowerCase());

  function update(id: number, patch: Partial<Row>) {
    setReview(false);
    setError(null);
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function setParty(id: number, text: string) {
    const found = byName.get(text.trim().toLowerCase());
    update(id, { party: found ? found.name : text, bankKey: found?.defaultKey });
  }

  /** What is wrong with a row, in words. Undefined when the row is ready. */
  function problemOf(row: Row): string | undefined {
    const p = partyOf(row);
    if (row.party.trim() === "") return "Choose a party.";
    if (!p) return "This party is not in Bene Master.";
    const option = p.options.find((o) => o.key === row.bankKey);
    if (!option) return p.options.length > 1 ? "Choose the bank account." : "No bank account.";
    if (option.problems.length > 0) return `Bank details are not valid (${option.problems.join(", ")}). Fix Bene Master.`;
    if (paiseOf(row.amount) === undefined) return "Type an amount more than zero, with 2 decimals at most.";
    return undefined;
  }

  const filled = rows.filter((r) => r.party.trim() !== "" || r.amount.trim() !== "" || r.reference.trim() !== "");
  const problems = filled.map((r) => problemOf(r));
  const ready = filled.length > 0 && problems.every((p) => p === undefined) && paidDate !== "";
  const totalPaise = filled.reduce((sum, r) => sum + (paiseOf(r.amount) ?? 0), 0);

  useEffect(() => {
    if (review && !pending) confirmRef.current?.focus();
  }, [review, pending]);

  function addRow() {
    if (rows.length >= MAX_ROWS) return;
    setReview(false);
    setRows((prev) => [...prev, emptyRow(nextId.current++)]);
  }

  function removeRow(id: number) {
    setReview(false);
    setRows((prev) => (prev.length === 1 ? [emptyRow(nextId.current++)] : prev.filter((r) => r.id !== id)));
  }

  function confirm() {
    setError(null);
    const lines = filled.map((r) => ({
      softwareName: partyOf(r)?.name ?? r.party,
      bankKey: r.bankKey,
      amountPaise: paiseOf(r.amount) ?? 0,
      paidDate,
      reference: r.reference,
    }));
    start(async () => {
      const result = await createInstantBatchAction(lines);
      if (result.ok) {
        // The batch page starts the download of the CSV file.
        window.location.href = `/batches/${result.data.batchId}?download=1`;
      } else {
        setReview(false);
        setError(result);
      }
    });
  }

  return (
    <div className="instant">
      <datalist id="instant-parties">
        {parties.map((p) => (
          <option key={p.name} value={p.name} />
        ))}
      </datalist>

      <div className="toolbar">
        <label className="field">
          <span className="muted">Paid date</span>
          <DateField label="Paid date" value={paidDate} onChange={(iso) => { setReview(false); setPaidDate(iso); }} />
        </label>
      </div>

      <div className="instant-rows">
        {rows.map((row, index) => {
          const p = partyOf(row);
          const touched = row.party.trim() !== "" || row.amount.trim() !== "";
          const problem = touched ? problemOf(row) : undefined;
          return (
            <div key={row.id} className={`instant-row${problem ? " has-problem" : ""}`}>
              <span className="muted n">{index + 1}</span>
              <label className="field party">
                <span className="muted">Party (Bene Master)</span>
                <input
                  list="instant-parties"
                  value={row.party}
                  placeholder="Type to search"
                  onChange={(e) => setParty(row.id, e.target.value)}
                  aria-label={`Party, line ${index + 1}`}
                  autoFocus={index === 0}
                />
              </label>
              <label className="field bank">
                <span className="muted">Bank account</span>
                {!p ? (
                  <span className="muted">Choose a party first</span>
                ) : p.options.length === 1 ? (
                  <span>
                    {p.options[0]?.accountName} <span className="muted small">{p.options[0]?.ifsc} ····{p.options[0]?.last4}</span>
                  </span>
                ) : (
                  <select
                    value={row.bankKey ?? ""}
                    onChange={(e) => update(row.id, { bankKey: e.target.value === "" ? undefined : e.target.value })}
                    aria-label={`Bank account, line ${index + 1}`}
                  >
                    <option value="">Choose one of {p.options.length} accounts</option>
                    {p.options.map((o) => (
                      <option key={o.key} value={o.key} disabled={o.problems.length > 0}>
                        {o.accountName} · {o.ifsc} · ····{o.last4}{o.problems.length > 0 ? " (not valid)" : ""}
                      </option>
                    ))}
                  </select>
                )}
              </label>
              <label className="field amount">
                <span className="muted">Amount (₹)</span>
                <input
                  className="amount"
                  inputMode="decimal"
                  value={row.amount}
                  onChange={(e) => update(row.id, { amount: e.target.value })}
                  aria-label={`Amount, line ${index + 1}`}
                />
              </label>
              <label className="field ref">
                <span className="muted">Reference (optional)</span>
                <input
                  value={row.reference}
                  maxLength={60}
                  placeholder="for example: advance"
                  onChange={(e) => update(row.id, { reference: e.target.value })}
                  aria-label={`Reference, line ${index + 1}`}
                />
              </label>
              <button type="button" onClick={() => removeRow(row.id)} aria-label={`Remove line ${index + 1}`}>Remove</button>
              {problem ? <div className="bad small problem">{problem}</div> : null}
            </div>
          );
        })}
      </div>

      <div className="row">
        <button type="button" onClick={addRow} disabled={rows.length >= MAX_ROWS}>+ Add another payment</button>
      </div>

      {error ? (
        <div className="issue block" role="alert">
          <strong>{error.message}</strong>
          {error.details?.map((d) => <div key={d}>{d}</div>)}
        </div>
      ) : null}

      {review ? (
        <div className="card" role="status">
          <strong>Check before you make the file</strong>
          <table>
            <thead><tr><th>Paid date</th><th>Party</th><th>Bank account</th><th>Reference</th><th className="num">Amount</th></tr></thead>
            <tbody>
              {filled.map((r) => {
                const p = partyOf(r);
                const o = p?.options.find((x) => x.key === r.bankKey);
                return (
                  <tr key={r.id}>
                    <td>{formatDisplayDate(paidDate)}</td>
                    <td>{p?.name}</td>
                    <td>{o?.accountName} <span className="muted small">{o?.ifsc} ····{o?.last4}</span></td>
                    <td>{r.reference.trim() === "" ? <span className="muted">none</span> : `BN ${r.reference.trim()}`}</td>
                    <td className="num">{formatInr(paiseOf(r.amount) ?? 0)}</td>
                  </tr>
                );
              })}
              <tr><td colSpan={4}><strong>Total</strong></td><td className="num"><strong>{formatInr(totalPaise)}</strong></td></tr>
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="bar" role="region" aria-label="Instant payments">
        <div className="bar-row">
          <div className="bar-sum" aria-live="polite">
            <strong>{filled.length}</strong> {filled.length === 1 ? "payment" : "payments"} · <strong>{formatInr(totalPaise)}</strong>
          </div>
          <div className="bar-actions">
            {review ? (
              <>
                <button type="button" onClick={() => setReview(false)} disabled={pending}>Back</button>
                <button ref={confirmRef} type="button" className="primary" onClick={confirm} disabled={pending || !ready}>
                  {pending ? "Making the file…" : "Confirm and download"}
                </button>
              </>
            ) : (
              <button type="button" className="primary" disabled={!ready} onClick={() => { setError(null); setReview(true); }}>
                Make bank CSV
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
