import { describe, it, expect } from "vitest";
import { baseUrlFromHost } from "@/lib/auth/email-verify";

// ---------------------------------------------------------------------------
// HOST İZİN LİSTESİ: `localhost` / `127.0.0.1` YALNIZ TAM BİÇİMDE (09-23 saldırgan turu).
// Eski kontrol `startsWith("localhost:")` idi → `localhost:@evil.example` GEÇİYORDU ve
// kurulan taban `http://localhost:@evil.example` = kullanıcı adı "localhost", HOST
// `evil.example` (ajan ölçtü). Bu taban çıkış yönlendirmesi, eski doğrulama GET'i ve OAuth
// dönüşünde kullanılıyor. Bugün tarayıcılar Host başlığını değiştiremediği için İSTİSMAR
// EDİLEMİYOR — ama izin listesinin tek işi tam eşleşmedir, önek kontrolü onu delik bırakır.
// ---------------------------------------------------------------------------

const BASE = "https://www.lixusai.com";

describe("baseUrlFromHost — localhost yalnız tam biçimde", () => {
  it.each([
    ["localhost:@evil.example"],
    ["localhost:x@evil.example"],
    ["127.0.0.1:@evil.example"],
    ["localhost:3000@evil.example"],
    ["localhost:3000/evil"],
    ["localhost:999999"],
  ])("%j → güvenilir taban", (host) => {
    expect(baseUrlFromHost(host)).toBe(BASE);
    expect(new URL(baseUrlFromHost(host)).hostname).toBe("www.lixusai.com");
  });

  it.each([
    ["localhost", "http://localhost"],
    ["localhost:3000", "http://localhost:3000"],
    ["127.0.0.1:3000", "http://127.0.0.1:3000"],
  ])("KONTROL: geliştirme hostu %j → %j", (host, beklenen) => {
    expect(baseUrlFromHost(host)).toBe(beklenen);
  });
});
