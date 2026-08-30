// claim-seat — turns a signed-in Workspace account into a company seat.
//
// Two things happen here that must not happen in the browser: the Stripe
// session (which needs the secret key) and the handover of a seat from one
// chief executive to the next (which needs to demote the previous one, and
// the guard trigger refuses that to anyone but the service role).
//
// Everything else is deliberately done with the *caller's* token rather than
// the service role, so the database triggers still get to say no. A bug in
// this file cannot mint a seat for a domain Google did not vouch for.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY     = Deno.env.get("SUPABASE_ANON_KEY")!;
const STRIPE_KEY   = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const SITE_URL     = Deno.env.get("SITE_URL") ?? "https://gift.ceo";
const PRICE_RAPPEN = 1_000_000; // 10,000.00 CHF

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

async function stripeSession(params: Record<string, string>) {
  const body = new URLSearchParams(params);
  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${STRIPE_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const out = await res.json();
  if (!res.ok) throw new Error(out?.error?.message ?? "Stripe rejected the request.");
  return out as { id: string; url: string };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

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

  if (!STRIPE_KEY) {
    // Said plainly rather than as a 500: the seat and the CEO row are already
    // saved, so the only thing missing is the key, and whoever is deploying
    // needs to hear exactly that.
    return json({ error: "Payments are not configured yet (STRIPE_SECRET_KEY is not set)." }, 503);
  }

  let session;
  try {
    session = await stripeSession({
      "mode": "payment",
      "client_reference_id": companyId,
      "customer_email": user.email ?? "",
      "success_url": `${SITE_URL}/thank-you.html`,
      "cancel_url": `${SITE_URL}/join.html`,
      "metadata[company_id]": companyId,
      "metadata[domain]": domain,
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": "chf",
      "line_items[0][price_data][unit_amount]": String(PRICE_RAPPEN),
      "line_items[0][price_data][product_data][name]": `gift.ceo — seat for ${name}`,
      "line_items[0][price_data][product_data][description]":
        "One seat, one company, once. Non-refundable.",
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 502);
  }

  await admin.from("companies")
    .update({ stripe_session_id: session.id }).eq("id", companyId);

  return json({ checkout_url: session.url });
});
