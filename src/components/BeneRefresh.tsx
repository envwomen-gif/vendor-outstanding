"use client";

import { useState, useTransition } from "react";
import { refreshBeneAction } from "@/app/actions";

export function BeneRefresh() {
  const [message, setMessage] = useState<{ text: string; bad: boolean } | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="row">
      <button
        className="primary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await refreshBeneAction();
            if (r.ok) {
              setMessage({ text: `Done. ${r.data.rows} rows, ${r.data.withProblems} with problems.`, bad: false });
              window.location.reload();
            } else setMessage({ text: r.message, bad: true });
          })
        }
      >
        {pending ? "Working…" : "Refresh from Bene Master sheet"}
      </button>
      {message ? <span className={message.bad ? "bad" : "ok"} role="status">{message.text}</span> : null}
    </div>
  );
}
