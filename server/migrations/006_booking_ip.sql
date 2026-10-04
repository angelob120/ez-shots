-- Where a site booking came from, so one address cannot fill the calendar.
--
-- Booking is $0 and confirmed on the spot, which means a competitor or a bot
-- could book every open time and cost nothing. /api/book counts recent site
-- bookings by this address, by the client's email and phone, and in total,
-- and refuses past the limits in server.js. Only the address is kept, never
-- shown to the client.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS client_ip text NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS bookings_client_ip ON bookings (client_ip, created_at);
