// track — the whole of gift.ceo's analytics, and deliberately not much.
//
// One row per page view: which page, when, which country, which site sent the
// visit. No cookie is set, no visitor identifier is minted, and the IP address
// is never stored — it is read only in the form Cloudflare has already reduced
// to a two-letter country before the request arrives here. Two visits by one
// person are indistinguishable from two visits by two people. That is the
// point: this answers "is anyone arriving, and from where", which is the only
// traffic question a register of 10,000 CHF seats actually needs.
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

    // Set by Cloudflare in front of the function; absent when it cannot tell.
    // This is the only thing derived from the visitor's address, and the
    // address itself is not read, passed on, or stored.
    const country = (req.headers.get("cf-ipcountry") ?? "").slice(0, 2).toUpperCase() || null;
    const lang = String(body.lang ?? "").slice(0, 8) || null;

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { error } = await admin.from("page_views").insert({
      path,
      ref_host: refHost(body.ref),
      country: country === "XX" || country === "T1" ? null : country,
      lang,
    });
    if (error) console.error("track:", error.message);
  } catch (e) {
    console.error("track:", (e as Error).message);
  }

  return done();
});
