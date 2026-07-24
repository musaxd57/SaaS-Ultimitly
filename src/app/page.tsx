import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { LandingPage } from "@/components/marketing/landing-page";

// The homepage is the one page that canonicalizes to "/". The global canonical
// was removed from the root layout (it was inherited by every page, telling
// Google the legal/KVKK pages were duplicates of the homepage); each other page
// now self-canonicalizes to its own URL by default.
export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

export default async function Home() {
  const session = await getSession();
  // Logged-in users go straight to the app; everyone else sees the public
  // marketing landing page.
  if (session) redirect("/dashboard");
  return <LandingPage />;
}
