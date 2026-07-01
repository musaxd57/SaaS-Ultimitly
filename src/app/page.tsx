import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { LandingPage } from "@/components/marketing/landing-page";

export default async function Home() {
  const session = await getSession();
  // Logged-in users go straight to the app; everyone else sees the public
  // marketing landing page.
  if (session) redirect("/dashboard");
  return <LandingPage />;
}
