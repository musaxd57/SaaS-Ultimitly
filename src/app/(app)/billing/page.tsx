import { redirect } from "next/navigation";

// Billing lives inside Settings (the Faturalandırma section) — there is a single
// source of truth for the subscription UI. `/billing` is a friendly shortcut (the
// sidebar user card links here) that redirects to that section. Owner-only content
// is enforced there; a non-owner just lands on the default settings view.
export default function BillingPage() {
  redirect("/settings?tab=faturalandirma");
}
