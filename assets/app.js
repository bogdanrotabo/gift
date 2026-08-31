// gift.ceo — shared runtime: config, i18n, auth, and the few render helpers
// every page needs. Pages import from here; nothing here touches the DOM until
// a page asks it to.

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

// The project's custom domain, active since 31 August 2026. The generated
// gcfurwexhxqxuveojoih.supabase.co address still works and always will, but it
// is what Google shows a visitor on the sign-in screen — twenty characters of
// randomness where a company name belongs. Auth only travels through the domain
// the client is pointed at, so this line is what actually moves it.
//
// The Stripe webhook deliberately stays on the generated address: that is the
// endpoint registered with Stripe, and re-pointing it would mean a new endpoint
// and a new signing secret for no gain.
export const SUPABASE_URL = "https://api.gift.ceo";
export const SUPABASE_KEY = "sb_publishable_e5BQ_LFaIGCE-QJlKIxVgg_NkzlUgET";

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { flowType: "pkce", persistSession: true, autoRefreshToken: true }
});

export const SUPPORT_EMAIL = "gift.ceo.support@gmail.com";

// ------------------------------------------------------------------ languages

// The same 38 as rotabo.app, in the same order, so a visitor who knows one
// site finds the list where they expect it. `ready` is the only difference:
// a language appears in the picker once its file exists in /locales.
export const LANGS = [
  { code: "en", name: "English",          flag: "\u{1F1EC}\u{1F1E7}" },
  { code: "it", name: "Italiano",         flag: "\u{1F1EE}\u{1F1F9}" },
  { code: "ro", name: "Română", flag: "\u{1F1F7}\u{1F1F4}" },
  { code: "es", name: "Español",     flag: "\u{1F1EA}\u{1F1F8}" },
  { code: "fr", name: "Français",    flag: "\u{1F1EB}\u{1F1F7}" },
  { code: "de", name: "Deutsch",          flag: "\u{1F1E9}\u{1F1EA}" },
  { code: "pt", name: "Português",   flag: "\u{1F1F5}\u{1F1F9}" },
  { code: "zh", name: "中文",     flag: "\u{1F1E8}\u{1F1F3}" },
  { code: "ar", name: "العربية", flag: "\u{1F1F8}\u{1F1E6}" },
  { code: "ja", name: "日本語", flag: "\u{1F1EF}\u{1F1F5}" },
  { code: "ko", name: "한국어", flag: "\u{1F1F0}\u{1F1F7}" },
  { code: "ru", name: "Русский", flag: "\u{1F1F7}\u{1F1FA}" },
  { code: "ms", name: "Bahasa Melayu",    flag: "\u{1F1F2}\u{1F1FE}" },
  { code: "hi", name: "हिन्दी", flag: "\u{1F1EE}\u{1F1F3}" },
  { code: "sw", name: "Kiswahili",        flag: "\u{1F1F0}\u{1F1EA}" },
  { code: "vi", name: "Tiếng Việt", flag: "\u{1F1FB}\u{1F1F3}" },
  { code: "th", name: "ไทย", flag: "\u{1F1F9}\u{1F1ED}" },
  { code: "id", name: "Bahasa Indonesia", flag: "\u{1F1EE}\u{1F1E9}" },
  { code: "tr", name: "Türkçe", flag: "\u{1F1F9}\u{1F1F7}" },
  { code: "bn", name: "বাংলা", flag: "\u{1F1E7}\u{1F1E9}" },
  { code: "ur", name: "اردو", flag: "\u{1F1F5}\u{1F1F0}" },
  { code: "bg", name: "Български", flag: "\u{1F1E7}\u{1F1EC}" },
  { code: "cs", name: "Čeština", flag: "\u{1F1E8}\u{1F1FF}" },
  { code: "hr", name: "Hrvatski",         flag: "\u{1F1ED}\u{1F1F7}" },
  { code: "da", name: "Dansk",            flag: "\u{1F1E9}\u{1F1F0}" },
  { code: "et", name: "Eesti",            flag: "\u{1F1EA}\u{1F1EA}" },
  { code: "fi", name: "Suomi",            flag: "\u{1F1EB}\u{1F1EE}" },
  { code: "el", name: "Ελληνικά", flag: "\u{1F1EC}\u{1F1F7}" },
  { code: "ga", name: "Gaeilge",          flag: "\u{1F1EE}\u{1F1EA}" },
  { code: "lv", name: "Latviešu",    flag: "\u{1F1F1}\u{1F1FB}" },
  { code: "lt", name: "Lietuvių",    flag: "\u{1F1F1}\u{1F1F9}" },
  { code: "hu", name: "Magyar",           flag: "\u{1F1ED}\u{1F1FA}" },
  { code: "mt", name: "Malti",            flag: "\u{1F1F2}\u{1F1F9}" },
  { code: "nl", name: "Nederlands",       flag: "\u{1F1F3}\u{1F1F1}" },
  { code: "pl", name: "Polski",           flag: "\u{1F1F5}\u{1F1F1}" },
  { code: "sk", name: "Slovenčina",  flag: "\u{1F1F8}\u{1F1F0}" },
  { code: "sl", name: "Slovenščina", flag: "\u{1F1F8}\u{1F1EE}" },
  { code: "sv", name: "Svenska",          flag: "\u{1F1F8}\u{1F1EA}" }
];

// Translated so far. Adding a language is one file in /locales plus its code
// here — nothing else in the site needs to know. All 38 are in, so this is the
// same list as LANGS; it stays separate because a language should only be
// offered once its file exists, and that is worth being able to say no to.
export const READY = new Set(LANGS.map(l => l.code));

const RTL = new Set(["ar", "ur"]);
const STORAGE_KEY = "giftceo.lang";
const cache = Object.create(null);

let dict = {};
export let lang = "en";

function pickLang() {
  const q = new URLSearchParams(location.search).get("lang");
  if (q && READY.has(q)) return q;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && READY.has(saved)) return saved;
  } catch (e) { /* storage can be denied; the choice still applies to this page */ }
  for (const nav of navigator.languages || [navigator.language || "en"]) {
    const code = String(nav).slice(0, 2).toLowerCase();
    if (READY.has(code)) return code;
  }
  return "en";
}

// A missing key shows the key, not an empty space: a hole in the wording is a
// bug worth seeing rather than a gap the eye slides over.
export function t(key, fallback) {
  const val = key.split(".").reduce((o, k) => (o == null ? undefined : o[k]), dict);
  if (typeof val === "string") return val;
  return fallback !== undefined ? fallback : key;
}

async function fetchDict(code) {
  if (cache[code]) return cache[code];
  const res = await fetch(`/locales/${code}.json`, { cache: "no-cache" });
  if (!res.ok) throw new Error(`locale ${code} missing`);
  cache[code] = await res.json();
  return cache[code];
}

export function applyTranslations(root = document) {
  root.querySelectorAll("[data-i18n]").forEach(el => {
    el.textContent = t(el.getAttribute("data-i18n"));
  });
  root.querySelectorAll("[data-i18n-placeholder]").forEach(el => {
    el.setAttribute("placeholder", t(el.getAttribute("data-i18n-placeholder")));
  });
  root.querySelectorAll("[data-i18n-label]").forEach(el => {
    el.setAttribute("aria-label", t(el.getAttribute("data-i18n-label")));
  });
  // Only a whole-document pass announces itself. Translating a fragment must
  // stay silent: mountChrome translates its own fragment, and a listener that
  // re-mounts on the event would call itself forever.
  if (root === document) {
    // Every page used to take meta.title, so the whole site announced itself
    // as the home page — in the tab, in a bookmark, and in a shared link. A
    // page names its own key on <html data-title-key>; only the home page,
    // which names none, also owns the description.
    const key = document.documentElement.dataset.titleKey || "meta.title";
    const val = t(key, null);
    if (val && val !== key) {
      document.title = key === "meta.title" ? val : `${val} — gift.ceo`;
    }
    if (key === "meta.title") {
      const desc = document.querySelector('meta[name="description"]');
      const d = t("meta.description", null);
      if (desc && d && d !== "meta.description") desc.setAttribute("content", d);
    }
    document.dispatchEvent(new CustomEvent("i18n:applied", { detail: { lang } }));
  }
}

export async function setLang(code) {
  if (!READY.has(code)) code = "en";
  try {
    dict = await fetchDict(code);
  } catch (e) {
    if (code === "en") throw e;
    code = "en";
    dict = await fetchDict("en");
  }
  lang = code;
  document.documentElement.lang = code;
  document.documentElement.dir = RTL.has(code) ? "rtl" : "ltr";
  try { localStorage.setItem(STORAGE_KEY, code); } catch (e) {}
  applyTranslations();
}

// ------------------------------------------------------------------ helpers

export function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function fmtDate(value) {
  if (!value) return "";
  const d = new Date(value);
  if (isNaN(d)) return "";
  try {
    return d.toLocaleDateString(lang, { year: "numeric", month: "long", day: "numeric" });
  } catch (e) {
    return d.toISOString().slice(0, 10);
  }
}

export function param(name) {
  return new URLSearchParams(location.search).get(name);
}

// Only ever used on links a CEO typed. Anything that is not plainly http(s)
// is dropped rather than rendered, so a javascript: URL cannot ride in on a
// gift description.
export function safeUrl(raw) {
  if (!raw) return null;
  let u;
  try { u = new URL(String(raw).trim()); } catch (e) { return null; }
  return (u.protocol === "http:" || u.protocol === "https:") ? u.href : null;
}

// Logos and photos are shown on an https page, so an http one would break the
// padlock for the whole page rather than just fail quietly. Anything that is
// not plainly https is dropped and the initial shows instead.
export function safeImg(raw) {
  const u = safeUrl(raw);
  if (!u) return null;
  return u.startsWith("https://") ? u : null;
}

export function el(html) {
  const tpl = document.createElement("template");
  tpl.innerHTML = html.trim();
  return tpl.content.firstElementChild;
}

// ------------------------------------------------------------------ auth

export async function currentUser() {
  const { data } = await sb.auth.getUser();
  return data && data.user ? data.user : null;
}

// Google puts the Workspace domain in `hd`. Supabase files provider claims it
// does not have a column for under custom_claims, so look in both places.
export function hdOf(user) {
  if (!user) return null;
  const m = user.user_metadata || {};
  const raw = m.hd || (m.custom_claims && m.custom_claims.hd) || null;
  return raw ? String(raw).toLowerCase() : null;
}

export async function signIn(redirectTo) {
  routeAfterSignIn("auto");
  return sb.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: redirectTo || `${location.origin}/dashboard.html`,
      // hd=* asks Google to offer only Workspace accounts. It is a hint, not
      // a guarantee — the real check is the hd claim, server-side.
      queryParams: { hd: "*", prompt: "select_account" }
    }
  });
}

export async function signOut() {
  await sb.auth.signOut();
  location.href = "/";
}

// ------------------------------------------------------------------ chrome

function buildLangPicker() {
  const sel = document.createElement("select");
  sel.className = "langpick";
  sel.setAttribute("data-i18n-label", "nav.language");
  sel.setAttribute("aria-label", "Language");
  for (const l of LANGS) {
    if (!READY.has(l.code)) continue;
    const opt = document.createElement("option");
    opt.value = l.code;
    opt.textContent = `${l.flag}  ${l.name}`;
    sel.appendChild(opt);
  }
  sel.value = lang;
  sel.addEventListener("change", () => setLang(sel.value));
  return sel;
}

// The masthead is the same on every page, so it is built rather than pasted:
// one place to change, and no page can drift out of step with the others.
export function mountChrome(user) {
  const host = document.querySelector("[data-chrome]");
  if (!host) return;
  const signedIn = !!user;
  host.innerHTML = `
    <div class="wrap">
      <a class="wordmark" href="/">gift<span class="dot">.</span>ceo</a>
      <nav>
        <a class="nav-jump" href="/#gifts" data-i18n="nav.gifts">Gifts</a>
        <a class="nav-jump" href="/#companies" data-i18n="nav.companies">Companies</a>
        ${signedIn
          ? '<a href="/dashboard.html" data-i18n="nav.dashboard">Dashboard</a><a href="#" data-signout data-i18n="nav.signout">Sign out</a>'
          : '<a href="/join.html" data-i18n="nav.join">Join</a>'}
      </nav>
    </div>`;
  host.querySelector("nav").appendChild(buildLangPicker());
  const out = host.querySelector("[data-signout]");
  if (out) out.addEventListener("click", e => { e.preventDefault(); signOut(); });
  applyTranslations(host);
}

export function mountFooter() {
  const host = document.querySelector("[data-footer]");
  if (!host) return;
  host.innerHTML = `
    <div class="wrap">
      <p class="smallprint" data-i18n="footer.smallprint"></p>
      <div class="links">
        <a href="/terms.html" data-i18n="footer.terms">Terms</a>
        <a href="/privacy.html" data-i18n="footer.privacy">Privacy</a>
        <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>
      </div>
    </div>`;
  applyTranslations(host);
}

// Every page calls this first: language before paint, then the chrome, then
// its own work. The signed-in user is kept here so a language change can
// rebuild the masthead without the page having to hand it over again.
let chromeUser = null;

// ------------------------------------------------------------- after sign-in

// Where to go once Google sends the visitor back. Two problems share one
// mechanism. Supabase honours a redirectTo only if it is in the project's
// allow list and otherwise drops the visitor on the Site URL without a word,
// which reads as a broken sign-in; and the administrator should land on the
// panel wherever they signed in from, which cannot be decided in advance
// because nobody knows who is signing in until they have.
//
// So the intent is recorded before leaving and acted on when the session
// appears: an explicit path if a page asked for one, otherwise "auto", which
// means "decide from the account".
const ROUTE_KEY = "gift.routeAfterSignIn";

// Routing, never permission. admin-overview decides who may read the panel,
// against a JWT, on the server. This list only spares the one person who can
// from typing the address, and editing it in a console buys nothing but a
// page that answers 403.
const ADMIN_EMAILS = ["bogdan.tanase.ch@gmail.com"];

const isAdmin = (user) =>
  ADMIN_EMAILS.includes(String(user?.email ?? "").trim().toLowerCase());

export function routeAfterSignIn(where = "auto") {
  try { localStorage.setItem(ROUTE_KEY, where); } catch { /* private window */ }
}

// Runs on every page, does nothing on almost all of them. Only a stored intent
// plus a resolved session moves anyone, and the intent is consumed the first
// time both are true — so this fires once per sign-in and never traps the
// administrator on the panel afterwards.
function honourRoute(user) {
  // Checked before the key is read, not after. getUser() can resolve null
  // while detectSessionInUrl is still exchanging the PKCE code; consuming the
  // intent then would throw it away a moment before it became usable. The
  // caller runs this again from onAuthStateChange, when the session lands.
  if (!user) return;

  let want = null;
  try { want = localStorage.getItem(ROUTE_KEY); } catch { return; }
  if (!want) return;

  // Consumed before the jump, so a destination that cannot be reached leaves
  // nobody bouncing between two pages.
  try { localStorage.removeItem(ROUTE_KEY); } catch { /* ignore */ }

  const target = want === "auto"
    ? (isAdmin(user) ? "/admin.html" : null)
    : want;

  if (!target) return;
  // Same-origin and ours. "//evil.com" begins with a slash and is read by
  // browsers as another host, so that test alone would be an open redirect.
  if (!target.startsWith("/") || target.startsWith("//")) return;
  if (target === location.pathname) return;

  location.replace(target);
}

// ------------------------------------------------------------------ ga4

// Empty until a GA4 property exists. While it is empty nothing below runs: no
// tag is fetched, no banner is shown, and the site behaves exactly as it did
// before Google Analytics was ever considered. Paste the measurement ID here
// (the G-XXXXXXXXXX from Analytics > Admin > Data streams) and both switch on
// together — never one without the other, because the banner is the thing that
// makes the tag lawful in Switzerland and the EU.
//
// Set on 31 August 2026: property "gift.ceo" in the Rotabo Analytics account,
// stream "gift.ceo web" (15532758002). The property is linked to Google Ads
// 190-558-5049 with personalised advertising left OFF, which is the same line
// the three denied signals below draw — audiences are never published to the
// ad account, whatever a visitor accepts here.
export const GA4_ID = "G-8DBKJWE5ZD";

const CONSENT_KEY = "gift.consent";

function storedConsent() {
  try { return localStorage.getItem(CONSENT_KEY); } catch { return null; }
}

function storeConsent(v) {
  try { localStorage.setItem(CONSENT_KEY, v); } catch { /* private window */ }
}

// Loaded only after a yes. Google's own advice is to load the tag with consent
// denied and let it send cookieless pings, which is fine for a shop and wrong
// for a register that tells visitors nothing is stored if they decline. A no
// here means no request to Google at all.
function loadGA4() {
  if (!GA4_ID || window.__ga4Loaded) return;
  window.__ga4Loaded = true;

  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = gtag;

  // Set before the tag arrives, so nothing is written on the way in. Only
  // analytics is ever granted: the three advertising signals stay denied for
  // good, which is what "nothing is shared with advertisers" has to mean.
  gtag("consent", "default", {
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
    analytics_storage: "denied"
  });
  gtag("consent", "update", { analytics_storage: "granted" });

  const s = document.createElement("script");
  s.async = true;
  s.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(GA4_ID);
  document.head.appendChild(s);

  gtag("js", new Date());
  gtag("config", GA4_ID, { anonymize_ip: true });
}

function mountConsent() {
  if (!GA4_ID) return;

  const choice = storedConsent();
  if (choice === "granted") { loadGA4(); return; }
  if (choice === "denied") return;

  const bar = document.createElement("div");
  bar.className = "consent";
  bar.setAttribute("role", "dialog");
  bar.setAttribute("aria-live", "polite");
  bar.innerHTML =
    '<div class="consent__text"><strong>' + esc(t("consent.title", "Analytics cookies")) +
    '</strong><span>' + esc(t("consent.body", "Google Analytics shows us how this site is used.")) +
    ' <a href="/privacy.html">' + esc(t("consent.privacy", "Privacy")) + '</a></span></div>' +
    '<div class="consent__buttons">' +
    '<button class="btn btn--ghost" data-consent="denied">' + esc(t("consent.reject", "Decline")) + '</button>' +
    '<button class="btn" data-consent="granted">' + esc(t("consent.accept", "Accept")) + '</button>' +
    '</div>';

  bar.addEventListener("click", (e) => {
    const v = e.target.closest("[data-consent]")?.dataset.consent;
    if (!v) return;
    storeConsent(v);
    bar.remove();
    if (v === "granted") loadGA4();
  });

  document.body.appendChild(bar);
}

// --------------------------------------------------------------- attribution

// Which ad, if any, brought somebody here. Two different things arrive on the
// landing URL of a Google Ads click, and they are kept apart on purpose.
//
// The utm_* labels name a campaign. Everyone who clicks the same ad carries
// the same three, so they describe an ad and never a person; they ride along
// with the page view below and change nothing about what page_views is — the
// table still cannot tell two visits by one person from visits by two people.
//
// The gclid is the opposite: Google mints one per click and it identifies that
// click. It is never sent to `track`. It waits here, in this browser, and goes
// to the server only if this visitor claims a seat — a step where they hand
// over their name, their company and their Workspace address anyway. Somebody
// who reads and leaves is stored nowhere, which is what the privacy page says
// and has to keep meaning.
//
// Ninety days because that is Google Ads' own conversion window: an older
// click has stopped meaning anything and is dropped rather than credited.
const ATTRIB_KEY = "gift.attrib";
const ATTRIB_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

const cleanUtm = (v) =>
  (typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(v)) ? v.toLowerCase() : null;

const cleanGclid = (v) =>
  (typeof v === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(v)) ? v : null;

// The campaign behind THIS page view, read from the URL every time and never
// from storage: arriving later from a bookmark is an unlabelled visit, not a
// second visit from the ad.
function currentCampaign() {
  try {
    const q = new URLSearchParams(location.search);
    return {
      utm_source: cleanUtm(q.get("utm_source")),
      utm_medium: cleanUtm(q.get("utm_medium")),
      utm_campaign: cleanUtm(q.get("utm_campaign"))
    };
  } catch { return {}; }
}

// Called once, before anything else in boot(). Only a URL that actually
// carries a click overwrites what is stored, so coming back from a bookmark
// cannot erase the ad that started it.
function captureAttribution() {
  try {
    const q = new URLSearchParams(location.search);
    const gclid = cleanGclid(q.get("gclid"));
    const utm_source = cleanUtm(q.get("utm_source"));
    if (!gclid && !utm_source) return;
    localStorage.setItem(ATTRIB_KEY, JSON.stringify({
      gclid,
      utm_source,
      utm_medium: cleanUtm(q.get("utm_medium")),
      utm_campaign: cleanUtm(q.get("utm_campaign")),
      at: Date.now()
    }));
  } catch { /* private window, storage denied: attribution is never load-bearing */ }
}

// What join.html sends with a seat claim. Empty for everyone who did not
// arrive from an ad, which is the normal case.
export function storedAttribution() {
  try {
    const raw = localStorage.getItem(ATTRIB_KEY);
    if (!raw) return {};
    const a = JSON.parse(raw);
    if (!a || typeof a.at !== "number" || Date.now() - a.at > ATTRIB_MAX_AGE_MS) {
      localStorage.removeItem(ATTRIB_KEY);
      return {};
    }
    const out = {};
    for (const k of ["gclid", "utm_source", "utm_medium", "utm_campaign"]) {
      if (a[k]) out[k] = a[k];
    }
    return out;
  } catch { return {}; }
}

// ---------------------------------------------------------------- the counter

// One line per page view, sent to the `track` function and forgotten. It is
// never awaited: a counter that can delay a render is a counter that will
// eventually be blamed for a slow page. Failures are swallowed on purpose —
// an ad blocker refusing this request is a normal outcome, not an error worth
// showing anyone. /admin.html is skipped so the owner reading the numbers does
// not become the numbers.
function trackView() {
  try {
    const path = location.pathname;
    if (path.startsWith("/admin")) return;
    fetch(`${SUPABASE_URL}/functions/v1/track`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path,
        ref: document.referrer || null,
        lang,
        // The one location signal that never involves an IP address. Absent in
        // browsers that refuse it, which is fine: the row is still counted.
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
        // Campaign labels only, and only this visit's. The function rejects
        // anything that is not one of ours rather than storing it.
        ...currentCampaign()
      }),
      keepalive: true
    }).catch(() => {});
  } catch { /* never the reason a page fails */ }
}

export async function boot() {
  await setLang(pickLang());
  // Before the counter, because a click has to be remembered whether or not
  // the counter's request ever leaves the browser.
  captureAttribution();
  trackView();
  mountConsent();
  chromeUser = await currentUser();
  honourRoute(chromeUser);
  mountChrome(chromeUser);
  mountFooter();
  document.addEventListener("i18n:applied", () => {
    mountChrome(chromeUser);
    mountFooter();
  });
  sb.auth.onAuthStateChange((_event, session) => {
    chromeUser = session ? session.user : null;
    honourRoute(chromeUser);
    mountChrome(chromeUser);
  });
  return chromeUser;
}

// ------------------------------------------------------------------ render

export function giftCard(g, { link = true } = {}) {
  const state = g.state || "active";
  const href = `/gift.html?n=${encodeURIComponent(g.gift_number)}`;
  const tag = link ? "a" : "div";
  const node = el(`
    <${tag} class="gift" ${link ? `href="${href}"` : ""}>
      <span class="num">#${esc(g.gift_number)}</span>
      <span class="kind">${esc(t("type." + g.type, g.type))}</span>
      <h3></h3>
      <p class="body"></p>
      <div class="by">
        <span class="pill pill--${esc(state)}">${esc(t("state." + state, state))}</span>
        <span>${esc(t("feed.given_by"))} <strong></strong></span>
        <span class="co"></span>
      </div>
    </${tag}>`);
  node.querySelector("h3").textContent = g.title || "";
  node.querySelector(".body").textContent = g.description || "";
  node.querySelector(".by strong").textContent = g.ceo_name || "";
  const co = node.querySelector(".co");
  const logo = safeImg(g.company_logo_url);
  if (logo) {
    const img = document.createElement("img");
    img.className = "logo";
    img.src = logo;
    img.alt = "";
    img.loading = "lazy";
    co.appendChild(img);
  }
  co.appendChild(document.createTextNode(g.company_name || ""));
  if (g.valid_until) {
    const v = document.createElement("span");
    v.textContent = `${t("feed.valid_until")} ${fmtDate(g.valid_until)}`;
    node.querySelector(".by").appendChild(v);
  }
  return node;
}

export function companyCard(c) {
  const node = el(`
    <a class="company" href="/c.html?s=${encodeURIComponent(c.slug)}">
      <span class="initial"></span>
      <span>
        <span class="nm"></span><br>
        <span class="seat">${esc(t("feed.seat"))} #${esc(c.seat_number)}</span>
      </span>
    </a>`);
  node.querySelector(".nm").textContent = c.name || "";
  const badge = node.querySelector(".initial");
  const logo = safeImg(c.logo_url);
  if (logo) {
    const img = document.createElement("img");
    img.src = logo;
    img.alt = "";
    img.loading = "lazy";
    badge.replaceWith(img);
  } else {
    badge.textContent = (c.name || "?").trim().charAt(0).toUpperCase();
  }
  return node;
}
