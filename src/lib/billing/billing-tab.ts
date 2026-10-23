// ---------------------------------------------------------------------------
// Ayarlar › Faturalandırma sekmesi ne zaman VAR? (tek kural — Ayarlar sayfası ve sekmeye bağlantı veren her yüzey bunu okur)
//
// Sekme yalnız hesap sahibine ve Paddle yapılandırılmışken (istemci anahtarı + en az bir fiyat kimliği) çizilir. Başka durumda
// `?tab=faturalandirma` varsayılan sekmeye sessizce düşer — bağlantı veren yüzey (gelen kutusu kilitli anahtar, bant eylemi) bu yüzden
// önce buna bakar (Haiku 10-22: kilitli anahtarın "planınızı seçin" bağlantısı yapılandırma yokken AI sekmesine düşüyordu).
// ---------------------------------------------------------------------------

export function paddleConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  const token = env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN?.trim() || "";
  const prices = [env.PADDLE_PRICE_BASLANGIC, env.PADDLE_PRICE_PRO, env.PADDLE_PRICE_ISLETME].map((v) => v?.trim() || "");
  return Boolean(token) && prices.some((id) => id.length > 0);
}

export function billingTabAvailable(role: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return role === "owner" && paddleConfigured(env);
}
