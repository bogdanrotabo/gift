// gift.ceo — shared runtime: config, i18n, auth, and the few render helpers
// every page needs. Pages import from here; nothing here touches the DOM until
// a page asks it to.

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

export const SUPABASE_URL = "https://gcfurwexhxqxuveojoih.supabase.co";
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
// here — nothing else in the site needs to know.
export const READY = new Set(["en", "ro"]);

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
    const title = t("meta.title", null);
    if (title && title !== "meta.title") document.title = title;
    const desc = document.querySelector('meta[name="description"]');
    const d = t("meta.description", null);
    if (desc && d && d !== "meta.description") desc.setAttribute("content", d);
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

export async function boot() {
  await setLang(pickLang());
  chromeUser = await currentUser();
  mountChrome(chromeUser);
  mountFooter();
  document.addEventListener("i18n:applied", () => {
    mountChrome(chromeUser);
    mountFooter();
  });
  sb.auth.onAuthStateChange((_event, session) => {
    chromeUser = session ? session.user : null;
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
  if (g.company_logo_url) {
    const img = document.createElement("img");
    img.className = "logo";
    img.src = g.company_logo_url;
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
  if (c.logo_url) {
    const img = document.createElement("img");
    img.src = c.logo_url;
    img.alt = "";
    img.loading = "lazy";
    badge.replaceWith(img);
  } else {
    badge.textContent = (c.name || "?").trim().charAt(0).toUpperCase();
  }
  return node;
}
