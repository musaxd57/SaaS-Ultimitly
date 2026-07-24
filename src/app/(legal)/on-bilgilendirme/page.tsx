import type { Metadata } from "next";
import { LEGAL_LAST_UPDATED } from "@/lib/legal-entity";
import { SECTIONS } from "./content";

export const metadata: Metadata = {
  title: "Ön Bilgilendirme Formu",
  description: "Lixus AI ücretli aboneliklerine ilişkin, Mesafeli Sözleşmeler Yönetmeliği kapsamında ön bilgilendirme formu.",
};

export default function PreliminaryInfoPage() {
  return (
    <article className="space-y-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">Ön Bilgilendirme Formu</h1>
        <p className="text-sm text-muted-foreground">Son güncelleme: {LEGAL_LAST_UPDATED}</p>
      </header>

      <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs leading-relaxed text-amber-700">
        ⚠️ <strong>Taslak:</strong> Bu form bir başlangıç şablonudur. Satıcı ve işletme
        bilgilerinin doğruluğunu teyit edin ve ödemeleri açmadan önce bir hukuk danışmanına
        inceletin.
      </div>

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
