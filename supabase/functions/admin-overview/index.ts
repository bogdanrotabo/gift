// admin-overview — everything the owner of the register can see, in one call.
//
// The gate is here and nowhere else. admin.html checks the signed-in address
// too, but only so it can show a polite refusal instead of an empty page: that
// check is decoration, trivially edited by anyone with a browser console. The
// real one is below, against the JWT Supabase verified, and it runs before a
// single row is read.
//
// Everything is read with the service role, because none of it is reachable
// otherwise: auth.users is not exposed through the API at all, and page_views
// has RLS on with no policy. That makes this function the only door, which is
// why it does nothing else.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY     = Deno.env.get("SUPABASE_ANON_KEY")!;
const SITE_URL     = Deno.env.get("SITE_URL") ?? "https://gift.ceo";

// Comma-separated, so a second administrator is a secret change and not a
// deploy. The default is the address that owns the project.
const ADMINS = (Deno.env.get("ADMIN_EMAILS") ?? "bogdan.tanase.ch@gmail.com")
  .split(",").map(s => s.trim().toLowerCase()).filter(Boolean);

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

// Views are aggregated in this function rather than in SQL. At the volumes a
// register like this sees, one pass over a bounded window is cheaper than the
// database objects the alternative needs; if the window ever fills, the cap
// below is the thing to replace with a grouped query, not the whole approach.
const VIEW_WINDOW_DAYS = 90;
const VIEW_ROW_CAP = 50000;

function tally(rows: Array<Record<string, any>>, key: string, limit = 12) {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const v = r[key];
    if (!v) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, n]) => ({ name, n }));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json({ error: "Sign in first." }, 401);

  const asUser = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });

  const { data: { user }, error: userErr } = await asUser.auth.getUser();
  if (userErr || !user) return json({ error: "Sign in first." }, 401);

  const email = (user.email ?? "").toLowerCase();
  if (!ADMINS.includes(email)) {
    // Deliberately not 404: the page exists, and pretending otherwise to the
    // one person who might legitimately be locked out helps nobody.
    console.error("admin-overview: refused", email);
    return json({ error: "This account is not an administrator." }, 403);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // ---------------------------------------------------------------- sign-ins
  // auth.users is the only place last_sign_in_at lives; profiles mirrors the
  // rest of it but is written on signup and never updated on return visits.
  const { data: userList, error: listErr } =
    await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (listErr) return json({ error: listErr.message }, 500);

  const people = (userList?.users ?? []).map(u => ({
    email: u.email ?? null,
    name: u.user_metadata?.full_name ?? null,
    hd: u.user_metadata?.hd ?? u.user_metadata?.custom_claims?.hd ?? null,
    provider: u.app_metadata?.provider ?? null,
    created_at: u.created_at ?? null,
    last_sign_in_at: u.last_sign_in_at ?? null,
  })).sort((a, b) =>
    String(b.last_sign_in_at ?? "").localeCompare(String(a.last_sign_in_at ?? "")));

  // ----------------------------------------------------------------- seats
  const { data: companies } = await admin
    .from("companies")
    .select("id,name,domain,country,seat_status,seat_number,paid_at,stripe_session_id,created_at")
    .order("created_at", { ascending: false });

  const { data: ceos } = await admin
    .from("ceos")
    .select("company_id,display_name,is_current,ceo_declared_at")
    .eq("is_current", true);

  const { count: giftCount } = await admin
    .from("gifts").select("id", { count: "exact", head: true });

  // ----------------------------------------------------------------- traffic
  const since = new Date(Date.now() - VIEW_WINDOW_DAYS * 864e5).toISOString();
  const { data: views } = await admin
    .from("page_views")
    .select("path,ref_host,country,created_at")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(VIEW_ROW_CAP);

  const rows = views ?? [];
  const byDay = new Map<string, number>();
  for (const r of rows) {
    const d = String(r.created_at).slice(0, 10);
    byDay.set(d, (byDay.get(d) ?? 0) + 1);
  }

  const day = (n: number) =>
    rows.filter(r => r.created_at >= new Date(Date.now() - n * 864e5).toISOString()).length;

  return json({
    as_of: new Date().toISOString(),
    people,
    seats: {
      companies: companies ?? [],
      ceos: ceos ?? [],
      gifts: giftCount ?? 0,
      paid: (companies ?? []).filter(c => c.paid_at).length,
      active: (companies ?? []).filter(c => c.seat_status === "active").length,
    },
    traffic: {
      window_days: VIEW_WINDOW_DAYS,
      capped: rows.length >= VIEW_ROW_CAP,
      total: rows.length,
      today: day(1),
      last_7: day(7),
      last_30: day(30),
      by_day: [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([d, n]) => ({ d, n })),
      paths: tally(rows, "path"),
      countries: tally(rows, "country"),
      referrers: tally(rows, "ref_host"),
    },
  });
});
