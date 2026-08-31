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
| Payments | Stripe Payment Link, 10,000 CHF (rotabo.app account, gift.ceo product) |
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
supabase/functions/    claim-seat, stripe-webhook, track, admin-overview
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
| Redirect URIs | `https://api.gift.ceo/auth/v1/callback` and `https://gcfurwexhxqxuveojoih.supabase.co/auth/v1/callback` |
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

The link is the one named **gift.ceo — Company seat**, on the rotabo.app
Stripe account, priced at 10,000 CHF:

```
https://buy.stripe.com/4gMcMYaJ8d3f0aa90o0co0e
```

It is the default in `claim-seat`, and `STRIPE_PAYMENT_LINK` in Supabase →
*Edge Functions → Secrets* overrides it when set — useful for pointing a
deploy at a test-mode link without touching code.

Until 31 August 2026 the default was rotabo.app's *Platinum* tier instead.
That link is also exactly 10,000 CHF, which is why the mistake went unnoticed:
it charged the right amount for the wrong product, booking revenue against
rotabo and issuing a receipt reading *Platinum sponsor* rather than a gift.ceo
seat. If a seat ever needs a different price, change it on the Stripe link —
the amount is not written down anywhere in this repo.

The link also needs **After payment → Redirect customers to a page you host →
`https://gift.ceo/thank-you.html`**, set on the link itself in Stripe. Without
it the buyer stops on Stripe's own confirmation page and never reaches
`thank-you.html`, which is the page that polls the database until the webhook
has flipped the seat to `active`. The payment would succeed and the buyer would
simply never see the seat go live.

Unlike the webhook signing secret, a Payment Link URL is public by design —
it is safe to paste into a chat window or commit to this repo.

**Done on 30 August 2026.** The endpoint `gift-ceo-seats`
(`we_1UA9z12eIfG2oegbnALMQGA6`) is live on the rotabo Stripe account and its
signing secret is installed as `STRIPE_WEBHOOK_SECRET`. A first endpoint was
created and then disabled after its secret leaked into a chat transcript;
replacing it was cheaper than rotating, because revoking a secret needs
two-factor re-authentication and creating an endpoint does not.

Check it any time with a plain GET — it answers whether a secret is set
without saying what it is:

```bash
curl https://gcfurwexhxqxuveojoih.supabase.co/functions/v1/stripe-webhook
```

If the secret ever has to be replaced again, in Stripe →
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

That URL keeps the generated `gcfurwexhxqxuveojoih.supabase.co` address even
though the project now answers on `api.gift.ceo` as well. It is the endpoint
registered with Stripe, and both domains serve the same functions, so moving it
would mean creating a new endpoint and installing a new signing secret to gain
nothing. Leave it.

Because the endpoint sits on rotabo.app's Stripe account, it also receives
rotabo's own sponsor payments. That is harmless: the webhook only writes when
`client_reference_id` matches a company row, and a rotabo sponsorship matches
nothing.

### Admin

`admin.html` is the operator's view: who has signed in, every seat and what was
paid for it, and the traffic counter below. It is `noindex, nofollow` and
linked from nowhere.

Access is decided in `admin-overview`, against the JWT Supabase has already
verified, before a single row is read. The page checks the address too, but
only to show a refusal instead of an empty screen — that check is decoration
and anyone can edit it in a browser console. The list of administrators is
`ADMIN_EMAILS` in the function's secrets, comma-separated, defaulting to the
address that owns the project; adding a second one is a secret change, not a
deploy.

Two things make an edge function the only sensible door here. `auth.users`,
where `last_sign_in_at` lives, is not exposed through the API at all, and
`page_views` has RLS enabled with no policy — so both are reachable only by
the service role, which lives in the functions and nowhere near a browser.

Note that the register's own sign-in sends Google `hd=*`, asking for Workspace
accounts only. The administrator is an ordinary Gmail address with no Workspace
domain, so `admin.html` deliberately signs in without that hint. This is also
why the admin account can never take a seat: no `hd` claim, no company.

Supabase honours a `redirectTo` only if it appears in the project's allow list
(*Authentication → URL Configuration → Redirect URLs*) and falls back to the
Site URL without saying so otherwise — which looks exactly like a broken
sign-in, when in fact the sign-in worked and the visitor landed on the home
page. Adding `https://gift.ceo/**` to that list saves a redirect, but nothing
depends on it.

Instead, the intent is recorded before leaving and acted on when the session
appears, in `honourRoute()`. A page may ask for a path — `admin.html` asks for
itself — or for `"auto"`, which the site's own sign-in uses because nobody
knows who is signing in until they have. `"auto"` sends an administrator to the
panel and leaves everyone else where Supabase put them.

`ADMIN_EMAILS` in `app.js` is routing, never permission: it spares the one
person who may read the panel from typing the address. Editing it in a console
buys a page that answers 403, because the list that matters is the one in
`admin-overview`, checked against a JWT on the server. The intent is consumed
the first time a session resolves, so this fires once per sign-in — the
administrator is not trapped on the panel afterwards.

### Traffic

`track` records one row per page view and nothing else: the path, the moment,
the browser's time zone, the region in its Accept-Language header, the page
language, and the referring host when it is not this site. No cookie, no
visitor identifier, no IP address read or stored.

The first version read `cf-ipcountry`. Cloudflare does sit in front of these
functions — `cf-connecting-ip`, `cf-ray` and `cf-visitor` all arrive — but
Supabase does not forward the country header, so every row was written with a
null country and the panel's geography was permanently empty. The time zone
replaces it, and is the better fit: it never involves the address at all, and
it separates `Europe/Zurich` from `Asia/Kolkata`, which is the question this
register needs answered. It is client-supplied, so it is validated against an
IANA-shaped pattern before it is stored, and nothing is decided on it.

Time zone and browser region answer different questions and the panel keeps
them apart: one is where somebody is, the other is what language they have set,
which is often somewhere else entirely. Two visits by one person cannot be told apart from visits
by two people, which is the whole design — it answers whether anyone is
arriving, never who.

The beacon is fired from `boot()` in `assets/app.js` and never awaited, so it
cannot slow a render; an ad blocker refusing it is a normal outcome. Bump the
`?v=` on every page when `app.js` changes, or returning visitors keep the old
one from cache.

`privacy.html` promised analytics would be announced before they were switched
on. That promise is kept in the same commit that added this, and the page now
describes exactly the fields above. If the counter ever grows a visitor
identifier, that page has to change first.

### Google Analytics

Off until `GA4_ID` in `assets/app.js` holds a measurement ID. While it is
empty, no tag is fetched and no consent bar is shown; the site behaves as if
GA4 had never been considered. Setting it switches on the tag *and* the bar
together, and they must never be separated — the bar is what makes the tag
lawful under the Swiss nLPD and the GDPR.

The bar is not decoration. Decline means no request is made to Google at all,
not even a cookieless one: Google's own advice is to load the tag with consent
denied and let it ping anyway, which is reasonable for a shop and wrong for a
register that has just told the visitor nothing is stored. On accept, only
`analytics_storage` is granted; `ad_storage`, `ad_user_data` and
`ad_personalization` stay denied permanently, so nothing here can feed
advertising.

The choice lives in `localStorage` under `gift.consent` and nowhere else, so it
is per-browser and invisible to us. The five `consent.*` strings are translated
in all 38 locales — the bar is the first thing a visitor sees, and it cannot be
the one part of the site in English.

Bump the `?v=` on every page whenever `app.js` or `style.css` changes.

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

## Search Console

Verified on 30 August 2026 as a **URL-prefix property** for `https://gift.ceo/`,
by the HTML-file method. `google1b1bcf074b1dcccd.html` sits in the repo root
and must not be deleted — verification is re-checked, and losing the file
loses the property along with the sitemap and every indexing request attached
to it.

The DNS-TXT route was tried first, for a domain property that would have
covered www and http too. Porkbun's record form did not persist the value and
the authoritative nameserver kept answering with no TXT at all, so the file
method won. If a domain property is wanted later, the TXT is the only way and
it has to go in by hand.

`sitemap.xml` is submitted and read (3 URLs), and the home page is indexed.
