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
| Payments | Stripe Payment Link, 10,000 CHF (rotabo.app account) |
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

## Google sign-in — done, and where it lives

Configured on 30 August 2026 and **in production**, so any Google Workspace
account in the world can sign in. Written down because none of it is visible
from the code:

| | |
|---|---|
| Google Cloud project | `gift-ceo` (`electric-nomad-507111-m5`) |
| Owner account | bogdan.tanase.ch@gmail.com |
| Developer contact | gift.ceo.support@gmail.com |
| OAuth client | *gift.ceo web*, `628322664029-cmsgm4fcj6g5spua88rbdn1q9q6cgu7m.apps.googleusercontent.com` |
| Redirect URI | `https://gcfurwexhxqxuveojoih.supabase.co/auth/v1/callback` |
| JS origin | `https://gift.ceo` |
| Supabase site URL | `https://gift.ceo`, allow-list `https://gift.ceo/**` |

The app asks only for `openid email profile`. Google treats those as
non-sensitive, which is why it could be published without a verification
review — **do not upload a logo to the branding page**, and keep the
authorised domains under ten: either would push the app into verification and
take sign-in down until it passed.

`gift.ceo.support@gmail.com` is a plain Gmail account, so it is fine as a
contact address and can never take a seat here: no Workspace, no `hd` claim.

## What still needs a human

### Stripe

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

## A note on caching

GitHub Pages serves assets with `Cache-Control: max-age=600`, so a returning
visitor keeps the old CSS and JS for ten minutes after a deploy — long enough
to look, from a phone, as though a change never shipped. The stylesheet and
the module are therefore referenced with a version query:

```html
<link rel="stylesheet" href="/assets/style.css?v=3">
<script type="module">import { boot } from "/assets/app.js?v=3";</script>
```

**Bump the number in every HTML file whenever `style.css` or `app.js`
changes**, or the change will not reach anyone who has already visited:

```bash
sed -i "s/?v=5/?v=6/g" *.html
```
