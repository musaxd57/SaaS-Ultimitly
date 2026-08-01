import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { auditActor, auditImpersonation } from "@/lib/audit";

// ---------------------------------------------------------------------------
// DENETİM KAYDININ FAİLİ, İMPERSONATION'DA OPERATÖRDÜR (derin denetim, 08-01).
//
// `admin.ts` bir operatör müşteri org'una girdiğinde oturumu MÜŞTERİNİN
// owner'ıyla imzalar; gerçek operatör yalnız `session.actorUserId`'de durur.
// Dolayısıyla `actorUserId: session.userId` yazan bir rota, operatörün yaptığı
// işi MÜŞTERİ yapmış gibi kaydeder.
//
// Bu, kaydın HİÇ OLMAMASINDAN KÖTÜDÜR: yanlış delil üretir. "Ben bu yükseltmeyi
// onaylamadım" diyen bir müşteriye karşı elimizdeki tek kanıt, onun kendi
// kullanıcı id'sini gösterir.
//
// Sözleşme `audit.ts`'te YAZILIYDI ve 11 rotada uygulanıyordu; 8 çağrı yerinde
// çıplak `session.userId` kalmıştı — aralarında PARA hareketi yapan
// `billing/plan-change` (upgrade = anında tahsilat) ve KVKK'nın zorunlu kıldığı
// misafir-silme kaydı da vardı.
//
// Bu test kuralı DEĞİŞMEZ yapar: yeni bir rota çıplak biçimi kullanırsa kırmızı.
// ---------------------------------------------------------------------------

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith(".ts") || p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

/**
 * Oturumdan türetilmeyen failler MEŞRUDUR ve bu taramanın dışındadır:
 * giriş / şifre-sıfırlama akışları oturum AÇILMADAN önce koşar (`user.id`),
 * orada impersonation kavramı yoktur.
 */
const BARE_SESSION_ACTOR = /actorUserId:\s*session\.userId\b/;

describe("denetim kaydı — impersonation'da fail OPERATÖRDÜR", () => {
  it("hiçbir kaynak dosyası çıplak `actorUserId: session.userId` yazmaz", () => {
    const offenders: string[] = [];
    for (const file of walk("src")) {
      const src = readFileSync(file, "utf8");
      if (BARE_SESSION_ACTOR.test(src)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it("denetim YAZAN her dosyada fail biçimi bilinen bir kalıptır", () => {
    // ⚠️ KAPSAM DAR TUTULDU: yalnız gerçekten denetim yazan dosyalar. Geniş bir
    // "actorUserId: geçen her satır" taraması üç yanlış-pozitif üretiyordu — JWT
    // payload'ının yeniden kurulması, bir Prisma `select`'i ve bu kuralın kendi
    // dokümantasyonu. Yanlış-pozitif üreten bir pin, ilk kırmızıda gevşetilir;
    // dar ve doğru olan pin yaşar.
    const bad: string[] = [];
    for (const file of walk("src")) {
      const src = readFileSync(file, "utf8");
      if (!src.includes("writeAudit")) continue; // denetim yazmayan dosya bu testin konusu değil
      for (const line of src.split("\n")) {
        if (!line.includes("actorUserId:")) continue;
        if (line.trim().startsWith("*") || line.trim().startsWith("//")) continue; // yorum
        if (line.includes("select:") || line.includes("payload.")) continue; // okuma/serileştirme
        const v = line.split("actorUserId:")[1] ?? "";
        const ok =
          v.includes("auditActor(") ||
          v.includes("session.actorUserId ?? session.userId") ||
          v.includes("user.id") || // oturum ÖNCESİ akışlar (giriş / şifre sıfırlama)
          v.includes("actorUserId,") || // parametre olarak geçirilen (çağıran sorumlu)
          v.includes("current.actorUserId") || // impersonate enter/exit'in kendisi
          v.includes("entry.actorUserId") || // audit.ts'in kendi yazıcıları
          v.includes("string | null") || // tip bildirimi
          v.includes("null");
        if (!ok) bad.push(`${file}: ${line.trim()}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("PARA ve KVKK rotaları izi metadata'ya da yazar", () => {
    const planChange = readFileSync("src/app/api/billing/plan-change/route.ts", "utf8");
    expect(planChange).toContain("auditActor(session)");
    expect(planChange).toContain("auditImpersonation(session)");
  });
});

describe("auditActor / auditImpersonation davranışı", () => {
  const customerOwner = { userId: "u-customer", actorUserId: undefined, actorEmail: undefined };
  const operatorInside = {
    userId: "u-customer", // impersonation'da oturum MÜŞTERİNİN owner'ıdır
    actorUserId: "u-operator",
    actorEmail: "operator@lixusai.com",
  };

  it("normal oturumda fail kullanıcının kendisidir", () => {
    expect(auditActor(customerOwner)).toBe("u-customer");
    expect(auditImpersonation(customerOwner)).toEqual({});
  });

  it("impersonation'da fail OPERATÖRDÜR (müşteri değil)", () => {
    expect(auditActor(operatorInside)).toBe("u-operator");
    expect(auditActor(operatorInside)).not.toBe("u-customer");
  });

  it("impersonation izi metadata'ya işlenir", () => {
    expect(auditImpersonation(operatorInside)).toEqual({ impersonated: true });
  });

  it("OPERATÖRÜN E-POSTASI metadata'ya YAZILMAZ (KVKK — denetim, 08-01)", () => {
    // `AuditLog.metadataJson` müşterinin KENDİ veri ihracına HAM olarak giriyor
    // (`data-export.ts`). Operatörün e-postası ÜÇÜNCÜ BİR KİŞİNİN kişisel
    // verisidir ve müşteriye aktarılmamalıdır. İlk yazımda yazılıyordu ve bir
    // güvenlik ajanı yakaladı. Delil değeri `actorUserId` (opak id) ile zaten
    // sağlanıyor.
    const meta = auditImpersonation(operatorInside);
    expect(JSON.stringify(meta)).not.toContain("operator@lixusai.com");
    expect(JSON.stringify(meta)).not.toContain("@");
    expect(Object.keys(meta)).toEqual(["impersonated"]);
  });
});
