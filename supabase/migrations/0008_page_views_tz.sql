-- Where a visit came from, without touching the address it came from.
--
-- The first attempt read cf-ipcountry. Cloudflare does sit in front of these
-- functions -- cf-connecting-ip, cf-ray and cf-visitor all arrive -- but
-- Supabase does not forward the country header, so every row was recorded with
-- a null country and the admin panel's geography was permanently empty.
--
-- The browser's own time zone replaces it. It is a better fit than the header
-- would have been: it never involves the IP address at all, and it separates
-- Europe/Zurich from Asia/Kolkata, which is the question this register
-- actually needs answered. It is client-supplied and so can be wrong or
-- absent; for counting traffic that is an acceptable trade, and nothing is
-- decided on it.
--
-- `country` stays, now filled from the region in Accept-Language when the
-- browser sends one. That is a statement about language settings rather than
-- location, and the panel labels it as such.

alter table public.page_views add column if not exists tz text;
