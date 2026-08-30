# gift.ceo

A public list of gifts given personally by chief executives, under their own
name and their company's name. One seat per company, 10,000 CHF once, forever.

Live at <https://gift.ceo>.

## How it is put together

No build step and no runtime on the developer's machine: hand-written HTML,
one shared stylesheet, one shared ES module, and JSON files for the wording.
Everything dynamic comes from Supabase over its REST API.

| Piece | Where |
|---|---|
| Pages | GitHub Pages, `main` branch, root |
| Database, auth, storage | Supabase project `gcfurwexhxqxuveojoih` (eu-central-1) |
| Payments | Stripe Checkout, driven by an Edge Function |
| DNS | Porkbun — four A records to GitHub, `CNAME www` |

```
index.html        landing page and the public feed
join.html         sign in, then take the company's seat
thank-you.html    waits for the webhook to activate the seat
dashboard.html    a CEO's own gifts, logo and profile
c.html            one company           (/c/<slug> forwards here)
gift.html         one gift              (/gift/<n> forwards here)
terms.html
privacy.html
404.html          also the router for the two pretty URL forms
assets/app.js     config, i18n, auth, card rendering
assets/style.css
locales/*.json    one file per language
supabase/migrations/   the schema, in order
supabase/functions/    claim-seat, stripe-webhook
```

## The rule the whole thing rests on

A seat belongs to a **domain**, and the only proof of a domain is the `hd`
claim in a Google Workspace ID token. That claim is copied into `profiles.hd`
by a trigger on `auth.users`, and every write path re-reads it:

* `companies_before_insert` derives the domain from the website and refuses
  the row unless it equals the caller's own `hd`.
* `ceos_before_insert` refuses to sign for a company whose domain is not the
  caller's.
* `gifts_before_insert` allows only the sitting CEO of a company whose seat is
  already active, and assigns `gift_number` itself.
* `companies_guard_update` and `ceos_guard_update` put the money-side columns
  back the way they found them on any update that did not come from the
  service role.

Because of the last one, a browser cannot set `seat_status`, `seat_number`,
`paid_at` or `stripe_session_id` no matter what it sends. Only the webhook can.

Personal Gmail accounts carry no `hd` claim, so they can never take a seat.
That is deliberate, not an oversight.

## What still needs a human

### 1. Google sign-in

The OAuth consent screen lives in Google Cloud project `gift-ceo`
(`electric-nomad-507111-m5`). Its last setup step is a checkbox accepting
Google's *API Services User Data Policy* — a legal agreement, so the account
holder ticks it, not an assistant.

Then, under **Client → Create client**:

* Type: *Web application*
* Authorised JavaScript origin: `https://gift.ceo`
* Authorised redirect URI:
  `https://gcfurwexhxqxuveojoih.supabase.co/auth/v1/callback`

Copy the client ID and secret into Supabase → *Authentication → Sign In /
Providers → Google*, and set the site URL to `https://gift.ceo` with
`https://gift.ceo/**` as a redirect allow-list entry.

The app only asks for `openid email profile`, which Google treats as
non-sensitive: **Publish app** makes it available to every Workspace account
without a verification review. Until it is published it works only for
accounts added to the test-user list.

### 2. Stripe

Payment goes through a **Payment Link**, not the Stripe API, so no secret key
is used or stored anywhere in this project. `claim-seat` appends
`?client_reference_id=<company id>` to the link; Stripe echoes that back on the
webhook, which is how a payment is matched to a seat.

The link currently in use is rotabo.app's *Platinum* tier, which is priced at
exactly 10,000 CHF:

```
https://buy.stripe.com/4gMbIUbNcbZbf5490o0co08
```

Two consequences worth knowing. Payments land in the **rotabo.app Stripe
account**, and the buyer's receipt says *Platinum sponsor*, not *gift.ceo
seat*. Both are fixed by creating a Payment Link of its own, named for what it
is, and setting `STRIPE_PAYMENT_LINK` in the function's secrets — the code
reads that first and only falls back to the link above.

The one secret needed is the webhook signature key. In Stripe →
*Developers → Webhooks*, add:

```
https://gcfurwexhxqxuveojoih.supabase.co/functions/v1/stripe-webhook
```

subscribed to `checkout.session.completed` and
`checkout.session.async_payment_succeeded`, then put its signing secret into
Supabase → *Edge Functions → Secrets* as `STRIPE_WEBHOOK_SECRET`.

Never paste that value into a chat window — type it straight into the Supabase
secrets page. Until it exists, the webhook rejects every delivery as unsigned,
which means a paid seat will not go live.

Because the endpoint sits on rotabo.app's Stripe account, it also receives
rotabo's own sponsor payments. That is harmless: the webhook only writes when
`client_reference_id` matches a company row, and a rotabo sponsorship matches
nothing.

## Adding a language

Two steps, and nothing else in the site needs to know:

1. Copy `locales/en.json` to `locales/<code>.json` and translate the values.
2. Add `<code>` to `READY` in `assets/app.js`.

`LANGS` already holds all 38 codes, in the same order and with the same native
names as rotabo.app. Arabic and Urdu switch the document to `dir="rtl"` on
their own.

## Pretty URLs

GitHub Pages has no rewrite rules, so `/c/<slug>` and `/gift/<n>` are served by
`404.html`, which forwards to `c.html?s=…` and `gift.html?n=…`. Those two
answer 200 and are the canonical, indexable forms; the pretty shapes are a
convenience for anyone typing or sharing one by hand.

## Local preview

Open the files directly and the ES module imports will fail on the `file://`
origin. Any static server works:

```bash
python3 -m http.server 8080
```
