// stripe-webhook — the only thing in the system allowed to say a seat is paid.
//
// The browser never reports its own success: it is redirected to /thank-you
// and waits for the database to change. That change happens here, and only
// after Stripe's signature over the exact bytes of the request has been
// verified, so a forged POST cannot activate a seat.
//
// Deploy with JWT verification OFF — Stripe does not send a Supabase token.

const SUPABASE_URL   = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY    = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SIGNING_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";
const TOLERANCE_S    = 300;

const enc = new TextEncoder();

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Stripe-Signature looks like: t=1699999999,v1=abc...,v1=def...
async function verify(raw: string, header: string | null): Promise<boolean> {
  if (!SIGNING_SECRET || !header) return false;
  let ts = "";
  const sigs: string[] = [];
  for (const part of header.split(",")) {
    const [k, v] = part.split("=", 2).map((s) => s?.trim() ?? "");
    if (k === "t") ts = v;
    else if (k === "v1") sigs.push(v);
  }
  if (!ts || !sigs.length) return false;

  // A signature that is valid but hours old is a replay, not a delivery.
  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(ts));
  if (!Number.isFinite(age) || age > TOLERANCE_S) return false;

  const expected = await hmacHex(SIGNING_SECRET, `${ts}.${raw}`);
  return sigs.some((s) => timingSafeEqual(s, expected));
}

async function patchCompany(id: string, patch: Record<string, unknown>) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/companies?id=eq.${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      headers: {
        "apikey": SERVICE_KEY,
        "Authorization": `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
      },
      body: JSON.stringify(patch),
    },
  );
  if (!res.ok) throw new Error(`db ${res.status}: ${await res.text()}`);
}

Deno.serve(async (req) => {
  // A plain GET is how a person checks the function is alive. It says whether
  // a signing secret is configured, and nothing else: knowing one exists is
  // not knowing what it is, and without this the only symptom of a missing
  // secret is every delivery silently failing.
  if (req.method === "GET") {
    return new Response(
      JSON.stringify({ ok: true, signing_secret_configured: SIGNING_SECRET.length > 0 }),
      { headers: { "Content-Type": "application/json" } },
    );
  }
  if (req.method !== "POST") return new Response("POST only", { status: 405 });

  const raw = await req.text();
  if (!await verify(raw, req.headers.get("Stripe-Signature"))) {
    return new Response("bad signature", { status: 400 });
  }

  let event: Record<string, any>;
  try { event = JSON.parse(raw); } catch { return new Response("bad json", { status: 400 }); }

  try {
    if (event.type === "checkout.session.completed" ||
        event.type === "checkout.session.async_payment_succeeded") {
      const s = event.data?.object ?? {};
      const companyId = s.metadata?.company_id ?? s.client_reference_id ?? null;

      if (companyId && s.payment_status === "paid") {
        // seat_number and activated_at are set by the trigger on the way in,
        // so the number reflects the order money actually landed.
        await patchCompany(companyId, {
          seat_status: "active",
          paid_at: new Date().toISOString(),
          stripe_session_id: s.id ?? null,
        });
      }
    }
  } catch (e) {
    // 500 asks Stripe to retry, which is what we want if the database blinked.
    console.error("stripe-webhook:", (e as Error).message);
    return new Response("retry", { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" },
  });
});
