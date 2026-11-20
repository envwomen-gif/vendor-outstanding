import { logoutAction } from "@/app/actions";
import { isAuthEnabled } from "@/lib/auth/session";

export function AuthBanner() {
  if (isAuthEnabled()) return null;
  return (
    <div className="banner" role="alert">
      Sign in is off. Anyone who has this link can see the bills and make bank files. Set APP_PASSWORD_HASH to turn it on.
    </div>
  );
}

export function LogoutButton() {
  if (!isAuthEnabled()) return null;
  return (
    <form action={logoutAction}>
      <button type="submit">Sign out</button>
    </form>
  );
}
