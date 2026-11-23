import { getDb } from "@/db";
import { InstantForm } from "@/components/InstantForm";
import { todayInIndia } from "@/lib/format";
import { listInstantParties } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function InstantPage() {
  const parties = await listInstantParties(getDb());
  return (
    <>
      <h1>Instant payment</h1>
      <p className="muted">
        Pay a party now, with no bill. Choose the party from Bene Master and type the amount. The app makes the bank CSV in the same
        format as the Payments screen. The file shows in Batches, where you can download it again or undo it.
      </p>
      {parties.length === 0 ? (
        <p className="issue warning">Bene Master is empty. Refresh it on the Bene Master screen first.</p>
      ) : (
        <InstantForm parties={parties} today={todayInIndia()} />
      )}
    </>
  );
}
