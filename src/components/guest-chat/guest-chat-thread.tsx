import { Fragment } from "react";

// ---------------------------------------------------------------------------
// Misafirin QR sohbet ekranındaki mesaj akışı — SAF (hook yok, ağ yok). İki yer AYNI bileşeni kullanır:
//   · misafirin kendi ekranı (`guest-chat.tsx`, istemci, 5 sn'de bir yenilenir);
//   · ev sahibinin / destek görünümünün "Misafirin gördüğü ekran" önizlemesi (K14, kurucu kararı 09-30; sunucu, salt okunur).
// Böylece önizleme misafirin gördüğünden AYRIŞAMAZ (balon yönü, etiketler, "İşletme ekibi görüşmeye katıldı" ayraçları).
// ---------------------------------------------------------------------------

export type GuestChatRole = "guest" | "ai" | "host" | "resume";
export interface GuestChatMessage {
  id: string;
  role: GuestChatRole;
  text: string;
}

// Guest-facing title. Deliberately a FIXED brand string, never the internal
// Property.name — that name is the host's private label (often an owner name or
// informal code) and must not leak onto this public, unauthenticated QR page.
// The guest is physically in the unit, so no per-property label is needed.
export const GUEST_ASSISTANT_TITLE = "Lixus AI Misafir Asistanı";
/** Tek seferlik açıklama — başlıkta BİR kez, her mesajın altında tekrar edilmez. */
export const GUEST_CHAT_DISCLOSURE =
  "Yanıtlar yapay zekâ tarafından hazırlanabilir. Gerektiğinde işletme ekibi görüşmeye katılabilir.";
/** Henüz mesaj yokken misafirin gördüğü karşılama kartı. */
export const GUEST_CHAT_INTRO =
  "Merhaba! 👋 Konaklamanızla ilgili sorularınızı (çöp günü, cihazlar, kurallar, çevre önerileri…) buraya yazabilirsiniz.";
/** Konaklama bitince misafirin gördüğü kapanış kartı. */
export const GUEST_CHAT_CLOSED = "Konaklamanız sona erdiği için sohbet kapandı. İyi günler dileriz!";
// Wi-Fi artık bağlı cihazdaki misafire verilebilir (kurucu kararı 10-11) → not yalnız kapı kodunu anar (kurucu onaylı metin).
export const GUEST_CHAT_FOOTER = "Otomatik asistan + ev sahibi. Kapı kodu gibi giriş bilgileri güvenlik için burada paylaşılmaz.";

/**
 * Mesaj balonları + devir ayraçları. Ayraçlar diziden türetilir: bir ev sahibi mesajı, önceki devir işareti "yeniden
 * etkinleştirildi" ise (ya da hiç yoksa) "İşletme ekibi görüşmeye katıldı" koşusunu başlatır; "resume" satırı balon değil,
 * "Lixus AI yeniden etkinleştirildi" ayracıdır.
 */
export function GuestChatThread({ messages }: { messages: readonly GuestChatMessage[] }) {
  return (
    <>
      {messages.map((m, i) => {
        const guest = m.role === "guest";
        const host = m.role === "host";
        const resume = m.role === "resume";
        const prevMarker = [...messages.slice(0, i)].reverse().find((x) => x.role === "host" || x.role === "resume");
        const startsHostRun = host && (!prevMarker || prevMarker.role === "resume");
        const separator = resume ? "Lixus AI yeniden etkinleştirildi" : startsHostRun ? "İşletme ekibi görüşmeye katıldı" : null;
        return (
          <Fragment key={m.id}>
            {separator ? (
              <div className="my-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                <span className="h-px flex-1 bg-border" />
                {separator}
                <span className="h-px flex-1 bg-border" />
              </div>
            ) : null}
            {resume ? null : (
              <div className={guest ? "flex justify-end" : "flex justify-start"}>
                <div
                  className={
                    guest
                      ? "max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-sm text-primary-foreground"
                      : host
                        ? "max-w-[85%] rounded-2xl rounded-bl-sm border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900"
                        : "max-w-[85%] rounded-2xl rounded-bl-sm border border-border bg-card px-3 py-2 text-sm"
                  }
                >
                  {!guest ? (
                    <p
                      className={
                        host ? "mb-0.5 text-[10px] font-semibold text-emerald-700" : "mb-0.5 text-[10px] font-semibold text-muted-foreground"
                      }
                    >
                      {host ? "👥 İşletme ekibi" : "🤖 Lixus AI"}
                    </p>
                  ) : null}
                  <p className="whitespace-pre-wrap break-words">{m.text}</p>
                </div>
              </div>
            )}
          </Fragment>
        );
      })}
    </>
  );
}
