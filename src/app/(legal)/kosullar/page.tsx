import type { Metadata } from "next";
import { LEGAL_LAST_UPDATED } from "@/lib/legal-entity";
import { SECTIONS } from "./content";

export const metadata: Metadata = {
  title: "Kullanım Koşulları",
  description: "Lixus AI yazılım hizmetinin kullanımına ilişkin kullanım koşulları ve kullanıcı sözleşmesi.",
};

export default function TermsPage() {
  return (
    <article className="space-y-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">Kullanım Koşulları</h1>
        <p className="text-sm text-muted-foreground">Son güncelleme: {LEGAL_LAST_UPDATED}</p>
      </header>
      {SECTIONS.map((s) => (
        <section key={s.title} className="space-y-2">
          <h2 className="text-lg font-semibold">{s.title}</h2>
          {s.body?.map((p, i) => (
            <p key={i} className="text-sm leading-relaxed text-muted-foreground">{p}</p>
          ))}
          {s.list ? (
            <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed text-muted-foreground">
              {s.list.map((li, i) => (
                <li key={i}>{li}</li>
              ))}
            </ul>
          ) : null}
        </section>
      ))}
    </article>
  );
}
