-- U4 (kurucu 10-22): misafire görünen daire adı — QR sohbet başlığı. Boş olabilen tek sütun; dolu tabloya güvenli (varsayılan yok, NULL).
ALTER TABLE "Property" ADD COLUMN "guestDisplayName" TEXT;
