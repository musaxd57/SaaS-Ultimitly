import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { translate, __resetTranslateCache } from "@/lib/ai/translate";
import { confidentLanguage } from "@/lib/ai/language-signal";
import { isReasoningModel, layerReasoningEffort } from "@/lib/ai/model-family";
import { evalRuntime, evalRuntimeMarkdown } from "./run-meta";

// ---------------------------------------------------------------------------
// ÇEVİRİ KATMANI — model kıyası (10-01, kurucu: "her katmanı ayrı doğrulayalım"). Ürünün `translate()` fonksiyonu OLDUĞU GİBİ
// koşar (ev sahibinin cevabı misafirin diline; misafir mesajı ev sahibinin diline). Deterministik ölçüler: korunması gereken
// belirteçler (Wi-Fi adı / şifresi, kapı kodu, saat, tutar, URL, telefon, adres) çeviride BİREBİR mi; hedef dil kodun kesin
// tespitiyle tutuyor mu; başarısız / gecikme. LLM puanlayıcı YOK. Model: `OPENAI_TRANSLATE_MODEL` (boşsa `OPENAI_MODEL`), çaba:
// `OPENAI_TRANSLATE_REASONING_EFFORT`. İKİ KAPI: RUN_REAL_EVAL=1 + gerçek anahtar.
// ---------------------------------------------------------------------------

const key = process.env.OPENAI_API_KEY?.trim() ?? "";
const enabled = process.env.RUN_REAL_EVAL === "1" && key.length > 20 && !key.startsWith("test-");
const MODEL = process.env.OPENAI_TRANSLATE_MODEL?.trim() || process.env.OPENAI_MODEL?.trim() || "gpt-5.1";
const TAG = (process.env.EVAL_TRANSLATE_TAG ?? "").trim().replace(/[^a-z0-9.-]+/gi, "_");
const RPM = Number(process.env.EVAL_TRANSLATE_RPM) > 0 ? Number(process.env.EVAL_TRANSLATE_RPM) : 30;

const HOST_REPLIES: { text: string; keep: string[] }[] = [
  { text: "Merhaba! Wi-Fi ağı KumsalEv_5G, şifresi deniz2718. Bir sorun olursa modemi 30 saniye kapatıp açın.", keep: ["KumsalEv_5G", "deniz2718"] },
  { text: "Giriş saati 15:00, çıkış 11:00. Kapı kodu 4471# — kodu girdikten sonra kolu aşağı çekin.", keep: ["15:00", "11:00", "4471#"] },
  { text: "Otopark binanın arkasında, günlük 150 TL; ödemeyi resepsiyona yapabilirsiniz.", keep: ["150 TL"] },
  { text: "Havalimanı transferi tek yön 900 TL, en az 24 saat önceden bildirmeniz yeterli.", keep: ["900 TL", "24"] },
  { text: "Adresimiz: Kumru Sokak No: 9, Balbey, Muratpaşa / Antalya. Haritada https://maps.example.com/kumru9 bağlantısını açabilirsiniz.", keep: ["Kumru Sokak No: 9", "https://maps.example.com/kumru9"] },
  { text: "Acil bir durumda bina görevlisine +90 555 000 1234 numarasından ulaşabilirsiniz.", keep: ["+90 555 000 1234"] },
  { text: "Çöpler her gün 21:00'den sonra zemin kattaki yeşil konteynere bırakılmalı. Teşekkürler 🙏", keep: ["21:00", "🙏"] },
  { text: "Bagajlarınızı 10:00–14:00 arasında resepsiyondaki dolaba bırakabilirsiniz; dolap şifresi 2580.", keep: ["10:00", "14:00", "2580"] },
  { text: "Sessiz saatler 22:00–08:00. Balkonda sigara içilebilir, içeride içilmez.", keep: ["22:00", "08:00"] },
  { text: "Klimanın kumandası TV ünitesinin çekmecesinde. Mod düğmesine basıp ❄️ simgesini seçin.", keep: ["❄️"] },
  { text: "En yakın market Migros Jet, 200 metre ileride; 07:00–23:00 açık.", keep: ["Migros Jet", "07:00", "23:00"] },
  { text: "Rezervasyon numaranız HM4K2Q9 ile check-in formunu https://form.example.com/hm adresinden doldurabilirsiniz.", keep: ["HM4K2Q9", "https://form.example.com/hm"] },
];
const TARGETS = ["en", "de", "fr", "es", "ru", "ar"] as const;
const GUEST_MESSAGES: { text: string; src: string; keep: string[] }[] = [
  { text: "Hi! We land at 23:40 on flight TK2412 — is late check-in ok? Our code was 4471#, right?", src: "en", keep: ["23:40", "TK2412", "4471#"] },
  { text: "Hallo, das WLAN KumsalEv_5G funktioniert nicht. Passwort deniz2718 stimmt nicht?", src: "de", keep: ["KumsalEv_5G", "deniz2718"] },
  { text: "Bonjour, le parking coûte bien 150 TL par jour ? Merci !", src: "fr", keep: ["150 TL"] },
  { text: "Здравствуйте! Можно оставить багаж в 10:00? Номер брони HM4K2Q9.", src: "ru", keep: ["10:00", "HM4K2Q9"] },
];

interface Row {
  id: string;
  target: string;
  ok: boolean;
  keepAll: boolean | null;
  langOk: boolean | null;
  ms: number;
}

let lastStart = 0;
async function throttle(): Promise<void> {
  const wait = lastStart + 60_000 / RPM - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastStart = Date.now();
}

describe.skipIf(!enabled)(`ÇEVİRİ KATMANI — ${MODEL}`, () => {
  const rows: Row[] = [];
  beforeAll(() => __resetTranslateCache());

  afterAll(() => {
    if (rows.length === 0) return;
    const pct = (a: number, b: number) => (b === 0 ? "—" : `${a}/${b} (${Math.round((100 * a) / b)}%)`);
    const ms = rows.filter((r) => r.ok).map((r) => r.ms).sort((a, b) => a - b);
    const q = (p: number) => (ms.length ? ms[Math.min(ms.length - 1, Math.floor(p * ms.length))] : 0);
    const judged = rows.filter((r) => r.langOk !== null);
    const lines = [
      `# Çeviri katmanı — ${MODEL} (${new Date().toISOString().slice(0, 10)})`,
      "",
      `Düşünme (gönderilen): ${isReasoningModel(MODEL) ? (layerReasoningEffort(process.env.OPENAI_TRANSLATE_REASONING_EFFORT) ?? "gönderilmez (model varsayılanı)") : "yok (klasik model)"}`,
      "",
      "| ölçü | değer |",
      "|---|---|",
      `| başarısız çeviri (ürün fail-closed) | ${pct(rows.filter((r) => !r.ok).length, rows.length)} |`,
      `| 🚨 korunması gereken belirteçlerin HEPSİ birebir | ${pct(rows.filter((r) => r.keepAll === true).length, rows.filter((r) => r.keepAll !== null).length)} |`,
      `| hedef dil (kodun kesin tespiti olan satırlarda) | ${pct(judged.filter((r) => r.langOk).length, judged.length)} · tespitsiz ${rows.filter((r) => r.ok && r.langOk === null).length} |`,
      `| gecikme p50 / p95 | ${(q(0.5) / 1000).toFixed(1)} sn / ${(q(0.95) / 1000).toFixed(1)} sn |`,
      "",
      "## Belirteç kaybı olan satırlar",
      "",
      ...rows.filter((r) => r.keepAll === false).map((r) => `- ${r.id} → ${r.target}`),
      evalRuntimeMarkdown(evalRuntime()),
    ];
    const dir = path.resolve(__dirname, "../../docs/olcum");
    mkdirSync(dir, { recursive: true });
    const name = `ceviri-katmani-${new Date().toISOString().slice(0, 10)}-${MODEL.replace(/[^a-z0-9.-]+/gi, "_")}${TAG ? `-${TAG}` : ""}.md`;
    writeFileSync(path.join(dir, name), `${lines.join("\n")}\n`);
    console.log(`rapor yazıldı: docs/olcum/${name}`);
  });

  it(
    "ev sahibi cevabı → misafir dili, misafir mesajı → Türkçe",
    async () => {
      const jobs: { id: string; text: string; target: string; source?: string; keep: string[] }[] = [
        ...HOST_REPLIES.flatMap((h, i) => TARGETS.map((t) => ({ id: `h${i + 1}`, text: h.text, target: t, source: "tr", keep: h.keep }))),
        ...GUEST_MESSAGES.map((g, i) => ({ id: `g${i + 1}`, text: g.text, target: "tr", source: g.src, keep: g.keep })),
      ];
      for (const j of jobs) {
        await throttle();
        const t0 = Date.now();
        const r = await translate(j.text, j.target, j.source);
        const ms = Date.now() - t0;
        if (!r.ok) {
          rows.push({ id: j.id, target: j.target, ok: false, keepAll: null, langOk: null, ms });
          continue;
        }
        const detected = confidentLanguage(r.text);
        rows.push({
          id: j.id,
          target: j.target,
          ok: true,
          keepAll: j.keep.every((k) => r.text.includes(k)),
          langOk: detected === null ? null : detected === j.target,
          ms,
        });
      }
      expect(rows.length).toBeGreaterThan(0);
    },
    60 * 60 * 1000,
  );
});
