import { Fragment } from "react";
import { UserRound } from "lucide-react";
import { BrandMark } from "@/components/brand";
import { GUEST_COPY, type GuestLocale } from "./guest-chat-copy";

// ---------------------------------------------------------------------------
// Misafirin QR sohbet ekranındaki mesaj akışı — SAF (hook yok, ağ yok). İki yer AYNI bileşeni kullanır:
//   · misafirin kendi ekranı (`guest-chat.tsx`, istemci, 5 sn'de bir yenilenir);
//   · ev sahibinin / destek görünümünün "Misafirin gördüğü ekran" önizlemesi (K14, kurucu kararı 09-30; sunucu, salt okunur).
// Böylece önizleme misafirin gördüğünden AYRIŞAMAZ (balon yönü, avatarlar, etiketler, saat, "yeniden etkinleştirildi" ayracı).
// ---------------------------------------------------------------------------

export type GuestChatRole = "guest" | "ai" | "host" | "resume";
export interface GuestChatMessage {
  id: string;
  role: GuestChatRole;
  text: string;
  /** Mesajın saati ("07:29") — sunucu işletmenin saat diliminde kurar; yoksa (henüz gönderilmekte olan yerel satır) çizilmez. */
  time?: string;
}

// Guest-facing title. Deliberately a FIXED brand string, never the internal
// Property.name — that name is the host's private label (often an owner name or
// informal code) and must not leak onto this public, unauthenticated QR page.
// The guest is physically in the unit, so no per-property label is needed.
// Metinler TEK kaynakta (`guest-chat-copy.ts`, Türkçe / İngilizce — kurucu 10-22 U2); aşağıdaki sabitler Türkçe sürüm (ev sahibinin
// "misafirin gördüğü ekran" önizlemesi bunları okur).
export const GUEST_ASSISTANT_TITLE = GUEST_COPY.tr.title;
/** Tek seferlik açıklama — başlıkta BİR kez, her mesajın altında tekrar edilmez. */
export const GUEST_CHAT_DISCLOSURE = GUEST_COPY.tr.disclosure;
/** Henüz mesaj yokken misafirin gördüğü karşılama kartı. */
export const GUEST_CHAT_INTRO = GUEST_COPY.tr.intro;
/** Konaklama bitince misafirin gördüğü kapanış kartı. */
export const GUEST_CHAT_CLOSED = GUEST_COPY.tr.closed;
// Wi-Fi artık bağlı cihazdaki misafire verilebilir (kurucu kararı 10-11) → not yalnız kapı kodunu anar (kurucu onaylı metin).
export const GUEST_CHAT_FOOTER = GUEST_COPY.tr.footer;

/**
 * Gönderenin yuvarlak avatarı (3c, kurucu 11-11: "Airbnb'de başka biri yazınca nasıl görünüyorsa; logoyu güzelleştir"). Yapay zekâ = ürünün
 * kendi işareti (emoji değil: sistem yazı tipine göre değişmez, tema rengini alır); insan = nötr kişi simgesi.
 * 🚨 Tür ROLDEN seçilir (sunucunun `authorType`ı), addan / metinden değil — insan mesajı hiçbir zaman marka işaretini taşımaz.
 */
export function GuestChatAvatar({ kind }: { kind: "ai" | "host" }) {
  return (
    <span
      aria-hidden="true"
      data-avatar={kind}
      className={
        kind === "host"
          ? "flex size-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200"
          : "flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm"
      }
    >
      {/* Marka işaretinin çizimi kutusunun ortasındaki ~yarısını kaplar → kutu büyük tutulur ki işaret okunaklı olsun. */}
      {kind === "host" ? <UserRound className="size-[18px]" /> : <BrandMark className="size-7" />}
    </span>
  );
}

/**
 * Mesaj balonları. Misafir sağda (üstünde saat); yapay zekâ ve işletme solda — avatar + "Gönderen saat" etiketi + balon.
 * Ev sahibi yazınca araya "görüşmeye katıldı" çizgisi GİRMEZ (kurucu 11-11: tek cevap yazmak konuşmayı devralmak değildir; kim yazdığını
 * etiket söyler). "resume" satırı balon değil, "Lixus AI yeniden etkinleştirildi" ayracıdır — o gerçek bir durum değişikliği.
 */
export function GuestChatThread({ messages, locale = "tr" }: { messages: readonly GuestChatMessage[]; locale?: GuestLocale }) {
  const t = GUEST_COPY[locale];
  return (
    <>
      {messages.map((m) => {
        const guest = m.role === "guest";
        const host = m.role === "host";
        if (m.role === "resume") {
          return (
            <div key={m.id} className="my-1 flex items-center gap-2 text-xs text-muted-foreground">
              <span className="h-px flex-1 bg-border" />
              {t.separatorResume}
              <span className="h-px flex-1 bg-border" />
            </div>
          );
        }
        if (guest) {
          return (
            <Fragment key={m.id}>
              <div className="flex flex-col items-end">
                {m.time ? <p className="mb-0.5 mr-1 text-xs tabular-nums text-muted-foreground">{m.time}</p> : null}
                <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-sm text-primary-foreground">
                  <p className="whitespace-pre-wrap break-words">{m.text}</p>
                </div>
              </div>
            </Fragment>
          );
        }
        return (
          <div key={m.id} className="flex items-end justify-start gap-2">
            <GuestChatAvatar kind={host ? "host" : "ai"} />
            <div className="min-w-0 max-w-[85%]">
              <p className="mb-0.5 ml-1 flex items-baseline gap-1.5 text-xs text-muted-foreground">
                <span className={host ? "font-semibold text-emerald-700" : "font-semibold text-foreground/80"}>{host ? t.senderHost : t.senderAi}</span>
                {m.time ? <span className="tabular-nums">{m.time}</span> : null}
              </p>
              <div
                className={
                  host
                    ? "rounded-2xl rounded-bl-sm border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900"
                    : "rounded-2xl rounded-bl-sm border border-border bg-card px-3 py-2 text-sm"
                }
              >
                <p className="whitespace-pre-wrap break-words">{m.text}</p>
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
}
