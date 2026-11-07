-- Yalnız-ekle olay günlüğü (migration 63) — SİLME koruması (Haiku güvenlik incelemesi 10-12; kurucu kararı 10-10 §5 "silme yalnız saklama
-- süpürgesi ve hesap silmesi"): satır yalnız saklama süresini (90 gün; tetikleyici 89 günle bir günlük pay bırakır) aşınca ya da işletmesi
-- silinmişken (kademe) silinir. Prisma şeması tetikleyiciyi taşımaz → şema farkına girmez. 63 itildiği için AYRI migration (uygulanmış
-- migration değiştirilmez).
CREATE FUNCTION "operational_event_delete_guard"() RETURNS trigger AS $$
BEGIN
  IF OLD."createdAt" < now() - interval '89 days' THEN
    RETURN OLD;
  END IF;
  IF OLD."organizationId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Organization" WHERE "id" = OLD."organizationId") THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'OperationalEvent rows are deleted only by retention or organization deletion';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "OperationalEvent_delete_guard" BEFORE DELETE ON "OperationalEvent"
  FOR EACH ROW EXECUTE FUNCTION "operational_event_delete_guard"();

-- TRUNCATE satır tetikleyicisini atlar → ayrı deyim tetikleyicisiyle reddedilir (uygulamada TRUNCATE yolu yok; Haiku 2. tur). Bilinçli
-- bakım gerekirse veritabanı sahibi tetikleyiciyi açıkça kapatır (iz bırakan, elle yapılan işlem).
CREATE FUNCTION "operational_event_truncate_guard"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'OperationalEvent cannot be truncated';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "OperationalEvent_truncate_guard" BEFORE TRUNCATE ON "OperationalEvent"
  FOR EACH STATEMENT EXECUTE FUNCTION "operational_event_truncate_guard"();
