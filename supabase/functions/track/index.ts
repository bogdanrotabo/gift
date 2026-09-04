// track — the whole of gift.ceo's analytics, and deliberately not much.
//
// One row per page view: which page, when, roughly where from, in which
// language, which site sent the visit, and — since the ads started — which
// campaign. No cookie is set, no visitor identifier is minted, and no IP
// address is read or stored. Two visits by one person are indistinguishable
// from two visits by two people. That is the point: this answers "is anyone
// arriving, and from where", which is the only traffic question a register of
// 10,000 CHF seats actually needs.
//
// The campaign fields keep that promise. utm_source/medium/campaign are labels
// the campaign puts on its own links — "google", "cpc", "search-ch" — shared by
// everyone who clicks the same ad, so they narrow a visit to a campaign and
// never to a person. The gclid does the opposite: it is minted per click and
// identifies one. It is deliberately NOT accepted here. It reaches the database
// only through claim-seat, on the companies row, where a name and an email have
// already been given anyway.
//
// Public on purpose (verify_jwt is off): a visitor who has never signed in is
// exactly the visitor worth counting. Nothing it writes is readable through
// the API — page_views has RLS on and no policy, so only the service role,
// held here and by admin-overview, ever sees it.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SITE_URL     = Deno.env.get("SITE_URL") ?? "https://gift.ceo";

const CORS = {
  "Access-Control-Allow-Origin": SITE_URL,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

// Only ever our own paths, capped, and never a query string — a path is a page
// here, not a link. Anything else is dropped rather than cleaned up, because a
// counter that guesses is worse than one that skips.
function cleanPath(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  if (!s.startsWith("/") || s.length > 120) return null;
  if (s.includes("://") || s.includes("..")) return null;
  return s.split("?")[0].split("#")[0];
}

// Only the host, never the full referring URL: "which site sent them" is the
// useful part, and the rest is somebody else's page, sometimes with somebody
// else's query string in it. Self-referrals are internal navigation, not
// traffic, so they are recorded as null.
function refHost(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  try {
    const h = new URL(s).hostname.replace(/^www\./, "").toLowerCase();
    if (!h || h === new URL(SITE_URL).hostname.replace(/^www\./, "")) return null;
    return h.slice(0, 100);
  } catch {
    return null;
  }
}

// An IANA zone, e.g. "Europe/Zurich". Checked rather than trusted: it is sent
// by the browser, and this is the one field a visitor could otherwise use to
// write whatever they liked into the table.
function cleanTz(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  if (!s || s.length > 64) return null;
  return /^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+){0,2}$/.test(s) ? s : null;
}

// A campaign label as we write it into our own ad links: short, lowercase, and
// drawn from a small alphabet. Checked for the same reason cleanTz is — it
// arrives from the browser, and anyone can put anything in a query string.
// Rejected rather than trimmed into shape: a mislabelled visit is worse than an
// unlabelled one, because it quietly credits the wrong campaign.
function cleanUtm(raw: unknown): string | null {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s || s.length > 64) return null;
  return /^[a-z0-9][a-z0-9._-]*$/.test(s) ? s : null;
}

// The region of the browser's first language preference, when it has one:
// "de-CH,de;q=0.9" gives CH. This describes language settings, not where
// somebody is — a Romanian in Zurich may well send ro-RO — so the admin panel
// labels it "browser region" and the time zone above carries the location.
function regionFromAcceptLanguage(req: Request): string | null {
  const first = (req.headers.get("accept-language") ?? "").split(",")[0].trim();
  const m = /^[A-Za-z]{2,3}-([A-Za-z]{2})\b/.exec(first);
  return m ? m[1].toUpperCase() : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // 204 whatever happens below. A counter must never be the reason a page
  // breaks, so every failure here is silent to the visitor and loud only in
  // the function log.
  const done = () => new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return done();

  try {
    const body = await req.json();
    const path = cleanPath(body.path);
    if (!path) return done();

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { error } = await admin.from("page_views").insert({
      path,
      ref_host: refHost(body.ref),
      tz: cleanTz(body.tz),
      country: regionFromAcceptLanguage(req),
      lang: String(body.lang ?? "").slice(0, 8) || null,
      utm_source: cleanUtm(body.utm_source),
      utm_medium: cleanUtm(body.utm_medium),
      utm_campaign: cleanUtm(body.utm_campaign),
    });
    if (error) console.error("track:", error.message);
  } catch (e) {
    console.error("track:", (e as Error).message);
  }

  return done();
});
