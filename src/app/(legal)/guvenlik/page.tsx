import type { Metadata } from "next";
import { SECTIONS, SECURITY_TXT_EXPIRES } from "./content";

// ⚠️ `LEGAL_LAST_UPDATED` BİLİNÇLİ KULLANILMIYOR. O sabit, onaylanan sözleşme
// metinlerinin sürümüne bağlı; VDP onlardan bağımsız yaşar ve kendi geçerlilik
// tarihini `security.txt`'in `Expires` alanıyla PAYLAŞIR (test-pinli).
export const metadata: Metadata = {
  title: "Güvenlik Açığı Bildirimi",
  description:
    "Lixus AI güvenlik açığı bildirim politikası: kapsam, bildirim kanalı, yanıt süreleri ve iyi niyetli araştırma için yasal güvence.",
};

export default function SecurityPolicyPage() {
  return (
    <article className="space-y-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">Güvenlik Açığı Bildirimi</h1>
        <p className="text-sm text-muted-foreground">
          Geçerlilik: {SECURITY_TXT_EXPIRES.slice(0, 10)} tarihine kadar
        </p>
      </header>
      {SECTIONS.map((s) => (
        <section key={s.title} className="space-y-2">
          <h2 className="text-lg font-semibold">{s.title}</h2>
          {s.body?.map((p, i) => (
            <p key={i} className="text-sm leading-relaxed text-muted-foreground">
              {p}
            </p>
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
