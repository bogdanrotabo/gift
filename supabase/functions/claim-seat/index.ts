// claim-seat — turns a signed-in Workspace account into a company seat.
//
// One thing here genuinely cannot happen in the browser: the handover of a
// seat from one chief executive to the next, which has to demote the sitting
// one, and the guard trigger refuses that to anyone but the service role.
//
// Everything else is deliberately done with the *caller's* token rather than
// the service role, so the database triggers still get to say no. A bug in
// this file cannot mint a seat for a domain Google did not vouch for.
//
// No Stripe secret is used or stored: payment goes through a public Payment
// Link, and the seat is only ever activated by the webhook.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY     = Deno.env.get("SUPABASE_ANON_KEY")!;
const SITE_URL     = Deno.env.get("SITE_URL") ?? "https://gift.ceo";

// A Stripe Payment Link priced at 10,000 CHF, rather than a Checkout session
// minted through the API. It means no secret key has to live anywhere near
// this function: the link is public by design, and the only thing we add to it
// is the company id, which comes back on the webhook as client_reference_id.
//
// This must stay pointed at the link named "gift.ceo - Company seat". It was
// briefly rotabo.app's *Platinum* tier, which is also exactly 10,000 CHF and so
// looked harmless, but it charged the buyer for the wrong product: revenue
// booked against rotabo, and a receipt reading "Platinum sponsor" rather than a
// gift.ceo seat. The price lives in Stripe, not here — changing what a seat
// costs means editing the link, not this line.
const PAYMENT_LINK = (Deno.env.get("STRIPE_PAYMENT_LINK") ??
  "https://buy.stripe.com/4gMcMYaJ8d3f0aa90o0co0e").trim();

const CORS = {
  "Access-Control-Allow-Origin": SITE_URL,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

function normalizeDomain(raw: string): string | null {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s) return null;
  try {
    const u = new URL(/^[a-z]+:\/\//.test(s) ? s : "https://" + s);
    const host = u.hostname.replace(/^www\./, "");
    return host.includes(".") ? host : null;
  } catch {
    return null;
  }
}

const slugOf = (domain: string) =>
  domain.replace(/[^a-z0-9.-]/g, "").replace(/\./g, "-").slice(0, 100);

function hdOf(user: Record<string, any>): string | null {
  const m = user?.user_metadata ?? {};
  const raw = m.hd ?? m.custom_claims?.hd ?? null;
  return raw ? String(raw).toLowerCase() : null;
}

// client_reference_id is the whole trick: Stripe echoes it back on the
// checkout.session.completed event, so the webhook knows which seat was paid
// for without either side holding a secret.
function checkoutUrl(companyId: string, email: string): string {
  const u = new URL(PAYMENT_LINK);
  u.searchParams.set("client_reference_id", companyId);
  if (email) u.searchParams.set("prefilled_email", email);
  return u.href;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  // Only reachable if the secret is set but blank, which would otherwise throw
  // inside new URL() further down — after rows have been written. Fail before
  // anything is persisted, so a retry finds a clean slate rather than a
  // half-claimed seat.
  if (!PAYMENT_LINK) {
    console.error("STRIPE_PAYMENT_LINK is set but empty; refusing to start checkout");
    return json({ error: "Checkout is temporarily unavailable." }, 503);
  }

  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json({ error: "Sign in first." }, 401);

  // Acts as the caller: every insert below is still subject to RLS and to the
  // triggers that check the Workspace domain.
  const asUser = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  const { data: { user }, error: userErr } = await asUser.auth.getUser();
  if (userErr || !user) return json({ error: "Sign in first." }, 401);

  const hd = hdOf(user);
  if (!hd) {
    return json({ error: "Sign in with your company Google Workspace account." }, 403);
  }

  let body: Record<string, any>;
  try { body = await req.json(); } catch { return json({ error: "Bad request." }, 400); }

  // The domain is the identity here, so the company is always looked up by it
  // rather than by anything the caller sent.
  const { data: existing } = await admin
    .from("companies").select("id,seat_status,name").eq("domain", hd).maybeSingle();

  // ------------------------------------------------------------- handover
  if (body.takeover === true) {
    if (!existing || existing.seat_status !== "active") {
      return json({ error: "There is no active seat to take over." }, 409);
    }
    const { data: mine } = await admin.from("ceos")
      .select("id").eq("company_id", existing.id).eq("user_id", user.id)
      .eq("is_current", true).maybeSingle();
    if (mine) return json({ ok: true, already: true });

    // One current CEO per company is a unique index, so the outgoing one has
    // to step down before the incoming one is written.
    const { error: downErr } = await admin.from("ceos")
      .update({ is_current: false, ended_at: new Date().toISOString() })
      .eq("company_id", existing.id).eq("is_current", true);
    if (downErr) return json({ error: downErr.message }, 400);

    const now = new Date().toISOString();
    const { error: insErr } = await admin.from("ceos").insert({
      id: crypto.randomUUID(),
      user_id: user.id,
      company_id: existing.id,
      display_name: String(body.ceo_name ?? user.user_metadata?.full_name ?? user.email).slice(0, 120),
      linkedin_url: body.linkedin_url ? String(body.linkedin_url).slice(0, 300) : null,
      is_current: true,
      ceo_declared_at: now,
      terms_accepted_at: now,
    });
    if (insErr) return json({ error: insErr.message }, 400);
    return json({ ok: true });
  }

  // ------------------------------------------------------------- new seat
  if (existing && existing.seat_status === "active") {
    return json({ error: "This company already has an active seat." }, 409);
  }

  const domain = normalizeDomain(String(body.website ?? ""));
  if (!domain) return json({ error: "A valid company website is required." }, 400);
  if (domain !== hd) {
    return json({ error: `That website does not match your Google Workspace domain (${hd}).` }, 403);
  }

  const name    = String(body.name ?? "").trim().slice(0, 120);
  const country = String(body.country ?? "").trim().toUpperCase().slice(0, 2);
  const ceoName = String(body.ceo_name ?? "").trim().slice(0, 120);
  if (!name || country.length !== 2 || !ceoName) {
    return json({ error: "Company name, country and your name are required." }, 400);
  }

  let companyId = existing?.id ?? null;

  if (!companyId) {
    companyId = crypto.randomUUID();
    // Inserted as the caller on purpose: companies_before_insert re-checks the
    // domain against the caller's own hd claim.
    const { error } = await asUser.from("companies").insert({
      id: companyId,
      domain,                    // the trigger overwrites this from website
      website: `https://${domain}`,
      name,
      country,
      slug: slugOf(domain),
    });
    if (error) return json({ error: error.message }, 400);
  } else {
    await asUser.from("companies").update({ name, country }).eq("id", companyId);
  }

  const { data: ceoRow } = await admin.from("ceos")
    .select("id").eq("company_id", companyId).eq("user_id", user.id)
    .eq("is_current", true).maybeSingle();

  if (!ceoRow) {
    const now = new Date().toISOString();
    const { error } = await asUser.from("ceos").insert({
      id: crypto.randomUUID(),
      user_id: user.id,
      company_id: companyId,
      display_name: ceoName,
      linkedin_url: body.linkedin_url ? String(body.linkedin_url).slice(0, 300) : null,
      is_current: true,
      ceo_declared_at: now,
      terms_accepted_at: now,
    });
    if (error) return json({ error: error.message }, 400);
  }

  // The session id is not known until Stripe creates one, so it is written by
  // the webhook rather than guessed here.
  return json({ checkout_url: checkoutUrl(companyId, user.email ?? "") });
});
