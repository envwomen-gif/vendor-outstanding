import type { ReactNode } from "react";
import { AuthBanner, LogoutButton } from "@/components/AuthNav";
import "./globals.css";

export const metadata = { title: "Vendor Outstanding" };
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthBanner />
        <nav>
          <strong>Vendor Outstanding</strong>
          <a href="/">Payments</a>
          <a href="/instant">Instant</a>
          <a href="/import">Import</a>
          <a href="/batches">Batches</a>
          <a href="/bene">Bene Master</a>
          <a href="/audit">Audit log</a>
          <span className="grow" />
          <LogoutButton />
        </nav>
        <main>{children}</main>
      </body>
    </html>
  );
}
