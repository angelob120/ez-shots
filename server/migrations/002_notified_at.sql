-- The confirmation emails. One column, and it is a lock rather than a log: the
-- webhook and the success page both call confirmFromSession, so whichever gets
-- here first claims the send with
--
--   UPDATE bookings SET notified_at = now() WHERE id = $1 AND notified_at IS NULL
--
-- and the other one gets no row back and sends nothing. Without it a customer
-- who pays and lands on booked.html fast enough gets two confirmations for one
-- shoot, and phones to ask whether he was charged twice.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS notified_at timestamptz;
