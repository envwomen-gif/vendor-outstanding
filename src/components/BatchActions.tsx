"use client";

import { useEffect, useState, useTransition } from "react";
import { voidBatchAction } from "@/app/actions";

export function BatchActions({ batchId, voided, autoDownload }: { batchId: string; voided: boolean; autoDownload: boolean }) {
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (autoDownload && !voided) window.location.assign(`/batches/${batchId}/csv`);
  }, [autoDownload, batchId, voided]);

  return (
    <div className="card">
      <div className="row">
        <a className="button primary" href={`/batches/${batchId}/csv`}>Download CSV again</a>
        {!voided ? (
          <button
            disabled={pending}
            onClick={() => {
              if (!window.confirm("Undo this batch? The bills open again and can be paid again. The batch stays in the history as void.")) return;
              start(async () => {
                const r = await voidBatchAction(batchId, reason);
                if (r.ok) window.location.reload();
                else setMessage(r.message);
              });
            }}
          >
            {pending ? "Undoing…" : "Undo this batch"}
          </button>
        ) : null}
      </div>
      {!voided ? (
        <div className="row">
          <input aria-label="Reason (optional)" placeholder="Reason (optional), for example: test file" value={reason} onChange={(e) => setReason(e.target.value)} style={{ minWidth: 320 }} />
        </div>
      ) : null}
      {voided ? <p className="muted">This batch is undone. Its bills are open again on the Payments screen.</p> : null}
      {message ? <p className="bad" role="alert">{message}</p> : null}
    </div>
  );
}
