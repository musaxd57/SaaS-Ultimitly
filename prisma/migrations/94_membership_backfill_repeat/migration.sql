-- M-2 ÜYELİK — dilim 2: doldurmanın TEKRARI (tasarım docs/TASARIM-2026-11-06-uyelik-modeli-M2.md §6.1, Opus M10c).
-- Neden: dilim 1 yayınlanırken yeni kapsayıcı migration'ı koşturup açılana kadar ESKİ kod istek almaya devam eder; o arada açılan hesabın
-- üyeliği olmaz. Dilim 2'den sonra oturum üyelikten doğrulandığı için böyle biri giriş yapamazdı. Bu migration dilim 2 kodundan ÖNCE koşar
-- ve yalnız HİÇ üyeliği olmayan kullanıcılara ana işletme üyeliğini yazar (çıkarılmış üyelik satırı olan kişiye DOKUNMAZ — yeniden üye
-- yapmaz). Şema değişmez; tekrar koşulabilir.
INSERT INTO "Membership" ("id", "userId", "organizationId", "role", "status", "epoch", "origin", "singleMembershipGuard", "createdAt", "updatedAt")
SELECT 'mem_' || md5(u."id" || ':' || u."organizationId"), u."id", u."organizationId", u."role", 'active', 0, 'backfill', u."id", u."createdAt", CURRENT_TIMESTAMP
FROM "User" u
WHERE NOT EXISTS (SELECT 1 FROM "Membership" m WHERE m."userId" = u."id")
ON CONFLICT DO NOTHING;
