import { describe, it, expect } from "vitest";
import { REPLY_SYSTEM_PROMPT } from "@/lib/ai/prompts";
import { admitsMissingKnowledge } from "@/lib/ai/absence";

// ---------------------------------------------------------------------------
// 10. TUR — KURAL-5'in HAZIR CÜMLESİ KALDIRILDI (kurucu, 09-11).
//
// Kurucu: *"misafire kural 5 gibi bir cevap gitmemeli kesinlikle, 3 cümlesi de
// saçma — `Emin olmadığın her durumda: "Bu konuda kayıtlı bilgim yok; mesajınız
// kaydedildi, ev sahibiniz görebilir."` bu ne aq"*
//
// 🚨 KÖK NEDEN İSTEMDİ, MODEL DEĞİL. O cümle istemde BEŞ yerde EMREDİLİYORDU
// (PREAMBLE · kural çatışması örneği · KURAL-1 sonu · KURAL-5 · ÖRNEK 2 few-shot'ı)
// ve ÖRNEK 2 onu `confidence: 0.6` ile modele ÖĞRETİYORDU. 09-11'deki 9. turda
// "silersek model UYDURUR" demiştim; bu İKİLİ BİR YANLIŞ VARSAYIMDI — üçüncü ve
// doğru seçenek modele GERÇEĞİ söylemek: "temellendiremiyorsan ÜRETME, güveni
// düşür; ürün zaten devredecek."
//
// UYDURMA YASAĞI (KURAL-1) KALIR. Kalkan şey ezberletilen hazır paragraf.
// ---------------------------------------------------------------------------

/**
 * İstemin modele ÖRNEK olarak gösterdiği bütün cevap metinleri.
 * Few-shot blokları `{"...","reply":"...",...}` biçiminde JSON satırlarıdır.
 */
function taughtReplies(): string[] {
  return [...REPLY_SYSTEM_PROMPT.matchAll(/"reply":"((?:[^"\\]|\\.)*)"/gu)].map((m) =>
    m[1].replace(/\\"/g, '"'),
  );
}

describe("🚨 İSTEM, KENDİ KAPIMIZIN BLOKLAYACAĞI CEVABI ÖĞRETMEZ", () => {
  it("hiçbir few-shot `reply` metni yokluk itirafı DEĞİLDİR", () => {
    // 🚨 DEĞİŞMEZİN KENDİSİ: `src/lib/ai/absence.ts` bir cevabı misafire
    // göstermiyorsa, istem o cevabı modele ÖRNEK diye vermemeli. Aksi hâlde her
    // böyle mesajda bir OpenAI çağrısı yanar ve sonuç çöpe gider.
    // ⚠️ String eşleştirmesi DEĞİL, ÜRÜN YÜKLEMİ — kalıp listesi değişirse bu pin
    // kendiliğinden güncel kalır (ve iki taraf ayrışamaz).
    const replies = taughtReplies();
    expect(replies.length, "few-shot `reply` alanları bulunamadı — çapa bozulmuş").toBeGreaterThan(15);
    const blocked = replies.filter((r) => admitsMissingKnowledge(r));
    expect(blocked, `kapının bloklayacağı ${blocked.length} örnek cevap öğretiliyor`).toEqual([]);
  });

  it("kurucunun itiraz ettiği paragraf bir TALİMAT olarak da verilmez", () => {
    const low = REPLY_SYSTEM_PROMPT.toLocaleLowerCase("tr");
    expect(low, "hazır 'kayıtlı bilgim yok' cümlesi istemde kalmış").not.toContain("kayıtlı bilgim yok");
    // ⚠️ "mesajınız kaydedildi, ev sahibiniz görebilir" ibaresi TEK BAŞINA yasak
    // DEĞİLDİR: host KARARI olan konularda (iade, erken ayrılış — KURAL-4) meşru
    // teslim bildirimidir ve 09-09 P1 turunda kurucunun onayıyla kondu. Yasak olan
    // onu "bilgim yok"un arkasına yapıştırıp BİLGİSİZLİK PARAGRAFI yapmaktı.
    expect(REPLY_SYSTEM_PROMPT, "KURAL-4 teslim bildirimi yanlışlıkla silinmiş").toContain(
      "ev sahibinizin kararıdır",
    );
  });

  it("ÖRNEK 2 few-shot'ı o cevabı ÖĞRETMEZ (ama örnek SİLİNMEZ)", () => {
    // ⚠️ Few-shot bir DAVRANIŞ ÇAPASIDIR — silmek modeli o sınıfta serbest
    // bırakır. Örnek DURUR, öğrettiği davranış değişir.
    expect(REPLY_SYSTEM_PROMPT, "ÖRNEK 2 çapası silinmemeli").toContain("ÖRNEK 2");
    const ornek2 = REPLY_SYSTEM_PROMPT.slice(
      REPLY_SYSTEM_PROMPT.indexOf("ÖRNEK 2"),
      REPLY_SYSTEM_PROMPT.indexOf("ÖRNEK 3"),
    );
    expect(ornek2.length, "ÖRNEK 2 ↔ ÖRNEK 3 çapası bulunamadı").toBeGreaterThan(100);
    expect(ornek2.toLocaleLowerCase("tr")).not.toContain("bilgim yok");
    // 🚨 Ve DÜŞÜK GÜVEN öğretir: eski örnek 0.6 veriyordu, yani ürünün dar bandına
    // düşen bir değer. Artık kapının ALTINI öğretiyor.
    expect(ornek2).toMatch(/"confidence":0\.[0-3]\d*/);
  });
});

describe("🚨 KARŞI YÖN — uydurma yasağı ve devir mantığı DURUYOR", () => {
  it("KURAL-1 kaynak kısıtı ve icat yasağı aynen yerinde", () => {
    expect(REPLY_SYSTEM_PROMPT).toContain("KURAL-1");
    expect(REPLY_SYSTEM_PROMPT).toMatch(/KENDİ genel\/dünya bilgini ASLA KULLANMA/);
    expect(REPLY_SYSTEM_PROMPT).toMatch(/hiçbir koşulda icat etme/);
  });

  it("KURAL-5 DURUYOR ama artık DAVRANIŞ emrediyor, metin değil", () => {
    expect(REPLY_SYSTEM_PROMPT).toContain("KURAL-5");
    // 🚨 PİN KURAL-5 BLOĞUNUN İÇİNE ÇAPALI (mutasyon turu: blok dışına bakan iki
    // pin HAYATTA KALDI — "confidence 0.4" ve "somut" istemin BAŞKA yerlerinde de
    // geçiyor, o yüzden KURAL-5'ten silinseler bile yeşil kalıyorlardı).
    // ⚠️ ÇAPA "KURAL-5 [" OLMALI: düz "KURAL-5" isteme ÖNSÖZDE de geçiyor
    // ("KURAL-5'i uygula") ve slice oradan başlayınca BÖLÜM 1'in tamamını yutuyordu.
    const start = REPLY_SYSTEM_PROMPT.indexOf("KURAL-5 [");
    expect(start, "KURAL-5 blok başlığı bulunamadı").toBeGreaterThan(0);
    const k5 = REPLY_SYSTEM_PROMPT.slice(start, REPLY_SYSTEM_PROMPT.indexOf("BÖLÜM 2"));
    expect(k5.length, "KURAL-5 ↔ BÖLÜM 2 çapası bulunamadı").toBeGreaterThan(200);
    expect(k5, "KURAL-5'te düşük güven talimatı yok").toMatch(/confidence.{0,30}0[.,]4/su);
    expect(k5, "KURAL-5'te somut iddia yasağı yok").toMatch(/SOMUT hiçbir şey iddia etme/);
    // 🚨 İfade YASAK OLARAK anılır — bir yasağın konusunu adlandırması gerekir.
    // Aranan şey onun EMREDİLMEMESİ: "…yaz" değil "…yazma".
    expect(k5, "bilgisizlik açıklaması yasağı yok").toMatch(/BİLGİSİZLİK AÇIKLAMASI[\s\S]{0,60}yazma/u);
    expect(k5, "KURAL-5 hâlâ hazır metin dayatıyor").not.toMatch(/bilgim yok\.?"?\s*(yaz|de)\b/i);
  });

  it("makbuzsuz eylem/söz yasağı korunuyor (P1, 09-09)", () => {
    expect(REPLY_SYSTEM_PROMPT).toMatch(/ilettim/);
    expect(REPLY_SYSTEM_PROMPT).toMatch(/döneceğim/);
  });

  it("belirsiz ifade yasağı korunuyor", () => {
    expect(REPLY_SYSTEM_PROMPT).toMatch(/Sanırım/);
    expect(REPLY_SYSTEM_PROMPT).toMatch(/muhtemelen/);
  });

  it("🚨 KEMER + ASKI: istem düzeldi diye kod kapısı GEVŞETİLMEDİ", () => {
    // İki savunma AYRI yaşar: istem artık o paragrafı emretmiyor, ama model yine
    // de yazarsa `admitsMissingKnowledge` misafire gitmesini engeller. Bu satır
    // yüklemin hâlâ ÇALIŞTIĞINI davranışsal olarak sınar (ithal edilmiş olması
    // yetmez — 9. turda bir mutasyon tam da bunu gösterdi).
    expect(admitsMissingKnowledge("Bu konuda kayıtlı bilgim yok.")).toBe(true);
    expect(admitsMissingKnowledge("Otopark için ev sahibiniz size kesin bilgi verebilir.")).toBe(false);
  });
});
