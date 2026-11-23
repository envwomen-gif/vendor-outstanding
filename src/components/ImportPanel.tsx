"use client";

import { useState, useTransition } from "react";
import { importFromSheetAction, importFromUploadAction, type ActionResult } from "@/app/actions";
import type { ImportSummary } from "@/lib/import/service";

export function ImportPanel() {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult<ImportSummary> | null>(null);

  return (
    <>
      <div className="card">
        <h2>Read from the Google Sheet</h2>
        <p className="muted">Reads the OUTSTANDINGS tab of the Vendor Outstanding sheet. The app never writes to the sheet.</p>
        <button className="primary" disabled={pending} onClick={() => start(async () => setResult(await importFromSheetAction()))}>
          {pending ? "Working…" : "Import from sheet"}
        </button>
      </div>

      <form
        className="card"
        action={(formData) => start(async () => setResult(await importFromUploadAction(formData)))}
      >
        <h2>Upload the JS1 export</h2>
        <p className="muted">Use the .xls, .xlsx or .csv file from JS1 (max 5 MB). The app reads the dates as they are, so you do not need to change them.</p>
        <div className="row">
          <input type="file" name="file" accept=".xls,.xlsx,.csv" required />
          <button className="primary" disabled={pending}>{pending ? "Working…" : "Upload and import"}</button>
        </div>
      </form>

      {result && !result.ok ? (
        <div className="card" role="alert">
          <strong className="bad">{result.message}</strong>
          {result.details?.map((d) => <div key={d} className="muted">{d}</div>)}
        </div>
      ) : null}
      {result?.ok ? (
        <div className="card" role="status">
          <strong className="ok">Import done.</strong>
          <ul>
            <li>New bills: {result.data.billsNew}</li>
            <li>Changed bills: {result.data.billsUpdated}</li>
            <li>Unchanged bills: {result.data.billsUnchanged}</li>
            <li>Removed bills (not in the file any more): {result.data.billsClosed}</li>
            <li>Paid bills that JS1 still lists (kept locked): {result.data.billsPaidWaiting}</li>
            <li>Rows that the app could not read: {result.data.rejected.length}</li>
          </ul>
          {result.data.rejected.slice(0, 20).map((r) => (
            <div key={`${r.account}${r.docNo}${r.reason}`} className="muted">{r.account} {r.docNo}: {r.reason}</div>
          ))}
          <p><a className="button" href="/">Go to payments</a></p>
        </div>
      ) : null}
    </>
  );
}
