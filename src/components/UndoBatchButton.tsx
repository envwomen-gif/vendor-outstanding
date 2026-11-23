"use client";

import { useState, useTransition } from "react";
import { voidBatchAction } from "@/app/actions";

/** One-click undo for the Batches list. The reason is optional. */
export function UndoBatchButton({ batchId }: { batchId: string }) {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <>
      <button
        disabled={pending}
        onClick={() => {
          if (!window.confirm("Undo this batch? The bills open again and can be paid again. The batch stays in the history as undone.")) return;
          start(async () => {
            const r = await voidBatchAction(batchId, "");
            if (r.ok) window.location.reload();
            else setMessage(r.message);
          });
        }}
      >
        {pending ? "Undoing…" : "Undo"}
      </button>
      {message ? <span className="bad" role="alert"> {message}</span> : null}
    </>
  );
}
