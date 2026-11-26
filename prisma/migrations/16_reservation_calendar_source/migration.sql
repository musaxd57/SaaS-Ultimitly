-- Bind iCal-imported reservations to their CalendarSource (plain id, no FK).
-- Feed reconciliation may ONLY cancel rows bound to the SAME source: without
-- this, a feed cancelled every same-channel future booking it had never seen
-- (a second feed's rows, Hospitable's rows) -- mass-cancel. Nullable ADD COLUMN,
-- no default -> metadata-only, safe on a populated table. Legacy NULL rows are
-- re-bound on their next feed match and are NEVER reconciliation-cancellable.
ALTER TABLE "Reservation" ADD COLUMN     "calendarSourceId" TEXT;
