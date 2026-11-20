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
      </div>
      {!voided ? (
        <div className="row">
          <input placeholder="Reason, for example: bank rejected the file" value={reason} onChange={(e) => setReason(e.target.value)} style={{ minWidth: 320 }} />
          <button
            disabled={pending || reason.trim().length < 3}
            onClick={() => {
              if (!window.confirm("Void this batch? The bills can be paid again.")) return;
              start(async () => {
                const r = await voidBatchAction(batchId, reason);
                if (r.ok) window.location.reload();
                else setMessage(r.message);
              });
            }}
          >
            Void this batch
          </button>
        </div>
      ) : null}
      {message ? <p className="bad" role="alert">{message}</p> : null}
    </div>
  );
}
