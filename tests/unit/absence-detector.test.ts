import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { acknowledgesAbsence } from "../helpers/absence-detector";

// ---------------------------------------------------------------------------
// "BİLGİ YOKLUĞUNU SÖYLÜYOR MU" SÖZLEŞMESİ (09-11).
//
// 🚨 GERÇEK KOŞUDA ÖLÇÜLEN KUSUR: İngilizce kalıplar BİTİŞİKLİK istiyordu ve
// dürüst bir yokluk beyanı HAKSIZ YERE düşüyordu — hem `gpt-5.1` hem
// `gpt-5.6-luna` koşusunda R3'ü kırmızıya çevirdi ve model kıyasını okunamaz
// hâle getirdi. Ayrıca aynı liste İKİ harness'ta ayrı yazılmıştı ve biri bayattı.
//
// ⚠️ Bu dosya SÖZLEŞMEYİ pinler: neyin yokluk beyanı SAYILDIĞINI *ve* neyin
// SAYILMADIĞINI. İkinci yarı olmadan "gevşetme" fark edilmez.
// ---------------------------------------------------------------------------

describe("acknowledgesAbsence — DÜRÜST CAHİLLİK", () => {
  it("🚨 araya niteleme girse de sayılır (ölçülen harness kusuru)", () => {
    // Gerçek koşuda gelen cevap; eski kalıp `"don't have information"` bitişiklik
    // istediği için EŞLEŞMİYORDU ve senaryo haksız yere düşüyordu.
    expect(
      acknowledgesAbsence(
        "Hi, I don't have any specific information about parking for this apartment in my records; your message has been saved and is visible to the host.",
      ),
    ).toBe(true);
    expect(acknowledgesAbsence("I do not have detailed information on that.")).toBe(true);
    expect(acknowledgesAbsence("There is no record of that in my notes.")).toBe(true);
  });

  it("Türkçe biçimler sayılır", () => {
    for (const m of [
      "Bu konuda kayıtlı bilgim yok; mesajınız kaydedildi.",
      "Maalesef bilgim bulunmuyor.",
      "Elimde bu konuda bir bilgi yok.",
      "Bu bilgiye sahip değilim, ev sahibinize iletildi.",
    ]) {
      expect(acknowledgesAbsence(m), m).toBe(true);
    }
  });

  it("🚨 SAVUŞTURMA yokluk beyanı DEĞİLDİR (sözleşme genişletilmedi)", () => {
    // Gerçek koşuda `gpt-5.6-luna`nın legacy modda düşen üç cevabı bu sınıfta.
    // Kayıtlarda olmadığını SÖYLEMİYOR, sorumluluğu devrediyor.
    for (const m of [
      "Otopark bilgisi için ev sahibinizle iletişime geçebilirsiniz; mesajınız kaydedildi.",
      "Merhaba, otopark konusunda ev sahibiniz yardımcı olabilir. Mesajınız kaydedildi.",
      "I'm unable to confirm whether parking is available. Your message has been recorded.",
      "Bu konuyu ev sahibinize ileteceğim.",
    ]) {
      expect(acknowledgesAbsence(m), m).toBe(false);
    }
  });

  it("🚨 boşluk SINIRLI ve CÜMLECİK İÇİ — uzak kelimeler eşleşmez", () => {
    // "no" ile "information" arasında bir cümle sınırı varsa bu bir yokluk beyanı değildir.
    expect(
      acknowledgesAbsence("No. The information you need is in the welcome guide on the table."),
    ).toBe(false);
    expect(acknowledgesAbsence("Hayır, kayıt yapmadık ama gerekli bilgi kapıda asılı.")).toBe(false);
  });

  it("TEK KAYNAK PİNİ — iki eval harness'ı da kendi listesini YAZMAZ", () => {
    // ⚠️ Kaynak taraması tek yönlüdür; amacı ikinci bir kopyanın sessizce geri gelmesini
    // engellemek. Davranışsal yarı ↑yukarıdaki dört testtedir.
    const dir = path.resolve(__dirname, "../eval");
    for (const f of ["qr-kb-real-model.eval.test.ts", "kb-retrieval-paired.eval.test.ts"]) {
      const src = readFileSync(path.join(dir, f), "utf8");
      expect(src, f).toContain('from "../helpers/absence-detector"');
      expect(src, `${f} kendi ACK_ABSENCE listesini yeniden tanımlamamalı`).not.toMatch(
        /const\s+ACK_ABSENCE\s*=/u,
      );
    }
  });
});
