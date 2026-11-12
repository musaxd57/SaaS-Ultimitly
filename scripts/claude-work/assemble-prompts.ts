// `scripts/claude-work/run.ts`in alt süreç yardımcısı (istem denetimi): cevap modelinin GERÇEKTEN gördüğü girdiyi (sistem istemi +
// kullanıcı istemi) birkaç örnek senaryo için kurar ve tek satır JSON yazar. `src/lib/ai/prompts.ts` `server-only` içe aktardığı için
// ayrı süreçte, taklit yollu yapılandırmayla koşar: `npx tsx --tsconfig tests/workers/tsconfig.json scripts/claude-work/assemble-prompts.ts`.
// Ücretli çağrı yapmaz; veritabanı / ağ kullanmaz. Örnek veriler kurgusaldır (gerçek misafir / işletme verisi yok).
import { buildReplyPrompt, replySystemPromptFor } from "@/lib/ai/prompts";
import type { SuggestReplyInput } from "@/lib/ai/types";

const kb = [
  { category: "wifi", title: "Wi-Fi", content: "Ağ adı: Lale_Home, şifre: Lale2024. Modem salondaki TV ünitesinin altındadır." },
  { category: "parking", title: "Otopark", content: "Bina arkasındaki açık otopark misafirlerimize ücretsizdir." },
  { category: "amenities", title: "Havuz", content: "Havuz hafta sonu 23:00'e kadar açıktır." },
  { category: "local_tips", title: "Çevre", content: "Market 150 metre ileride, köşede. Restoran önerilerimiz: Balıkçı Hasan (10 dk yürüme), Köşe Kebap." },
  { category: "rules", title: "Çöp", content: "Çöpler bina girişinin sağındaki konteynere atılır." },
];

function base(over: Partial<SuggestReplyInput>): SuggestReplyInput {
  return {
    guestMessage: "",
    property: { name: "Lale – bahçe katı", checkInTime: "15:00", checkOutTime: "11:00", address: "Lale Sokak 7", city: "Antalya" },
    reservation: {
      guestName: "Deniz Yılmaz",
      guestGivenName: "Deniz",
      arrivalDate: new Date("2026-11-14T12:00:00Z"),
      departureDate: new Date("2026-11-18T12:00:00Z"),
      status: "confirmed",
    },
    guestIdentifier: "Deniz Yılmaz",
    knowledgeBase: kb,
    history: [],
    conversationState: { isFirstOperatorReply: true },
    tone: "warm",
    language: "tr",
    now: new Date("2026-11-13T10:00:00Z"),
    ...over,
  } as SuggestReplyInput;
}

const samples: { id: string; note: string; input: SuggestReplyInput }[] = [
  {
    id: "iki-soru-biri-kaynaksiz",
    note: "Tek mesajda iki istek: biri bilgi tabanında (otopark), biri yok (kahvaltı). Öğe kipi açık (açılış yapılandırması).",
    input: base({
      guestMessage: "Merhaba, otopark var mı? Bir de kahvaltı veriyor musunuz?",
      conversationItems: {
        answerable: [
          { ref: "R1", kind: "parking", hint: "otopark" },
          { ref: "R2", kind: "amenities", hint: "kahvaltı" },
        ],
        held: [],
      },
    }),
  },
  {
    id: "kosul-ve-yakin-varlik",
    note: "Koşullu kaynak (havuz yalnız hafta sonu için yazılmış) + yakın ama başka varlık (market var, eczane yok).",
    input: base({
      guestMessage: "Salı akşamı havuz kaça kadar açık? En yakın eczane ne kadar uzakta?",
      conversationItems: {
        answerable: [
          { ref: "R1", kind: "amenities", hint: "havuz saat" },
          { ref: "R2", kind: "local_recommendations", hint: "eczane mesafe" },
        ],
        held: [],
      },
    }),
  },
  {
    id: "cok-turlu-ingilizce",
    note: "Çok turlu konuşma, İngilizce misafir; önceki cevap konuşmada.",
    input: base({
      guestMessage: "Great, thanks! And where do we leave the trash when we check out?",
      language: "en",
      conversationState: { isFirstOperatorReply: false },
      history: [
        { direction: "inbound", body: "Hi! What's the Wi-Fi password?" },
        { direction: "outbound", body: "Hi Deniz,\n\nThe Wi-Fi network is Lale_Home and the password is Lale2024." },
      ],
      conversationItems: { answerable: [{ ref: "R1", kind: "trash", hint: "trash" }], held: [] },
    }),
  },
];

const OPENING = {
  codeGreeting: true,
  kbFeeRule: true,
  stayDeferralPlain: true,
  accessCodeComplete: true,
  complaintFollowup: true,
  itemsMode: true,
  itemsHeld: false,
  itemsParts: false,
  noApology: true,
  hostContactBan: true,
  noSourceRule: false,
};

const out = {
  openingFlags: OPENING,
  system: {
    opening: replySystemPromptFor(OPENING),
    openingPartsMode: replySystemPromptFor({ ...OPENING, itemsParts: true, noSourceRule: true }),
  },
  samples: samples.map((s) => {
    try {
      const built = buildReplyPrompt(s.input) as unknown as Record<string, unknown>;
      return { id: s.id, note: s.note, guestMessage: s.input.guestMessage, built };
    } catch (err) {
      return { id: s.id, note: s.note, guestMessage: s.input.guestMessage, error: err instanceof Error ? err.message.slice(0, 300) : String(err) };
    }
  }),
};
process.stdout.write(`${JSON.stringify(out)}\n`);
