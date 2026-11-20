"use client";

import { useActionState } from "react";
import { loginAction } from "@/app/actions";

export default function LoginPage() {
  const [state, action, pending] = useActionState(loginAction, undefined);
  return (
    <form action={action} className="card" style={{ maxWidth: 360, margin: "64px auto" }}>
      <h1>Sign in</h1>
      <div className="row">
        <input type="password" name="password" placeholder="Password" autoComplete="current-password" required autoFocus />
        <button className="primary" disabled={pending}>Sign in</button>
      </div>
      {state?.message ? <p className="bad" role="alert">{state.message}</p> : null}
    </form>
  );
}
