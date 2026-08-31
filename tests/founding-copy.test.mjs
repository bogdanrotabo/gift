// What the homepage says for each number of seats left.
//
//   node --test 'tests/*.test.mjs'
//
// foundingCopy is imported from a copy of app.js with its two network imports
// stripped: the decision under test is pure, but the module it lives in pulls
// in the Supabase client from a CDN, which a test has no business fetching.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const src = readFileSync(new URL("../assets/app.js", import.meta.url), "utf8")
  // The CDN import, and the client it builds, are the only things in this file
  // that reach the network. Nothing else in it is touched.
  .replace(/^import \{ createClient \}.*$/m, "const createClient = () => ({});");

const dir = mkdtempSync(join(tmpdir(), "giftceo-"));
const stub = join(dir, "app.mjs");
writeFileSync(stub, src);
const { foundingCopy } = await import(stub);

// A translator that hands back the key, so the assertions are about which
// string was chosen rather than about the English wording of it.
const tr = k => k;

test("seats remaining: the counter names the figure and the offer stands", () => {
  for (const n of [10, 7, 1]) {
    const c = foundingCopy(n, tr);
    assert.equal(c.line, "founding.counter".replace("{n}", String(n)));
    assert.equal(c.offering, true);
    assert.equal(c.note, "founding.note");
    assert.equal(c.why, "founding.why");
    assert.equal(c.cta, "cta.founding");
  }
});

test("the figure is substituted into the counter", () => {
  const withN = foundingCopy(7, k => (k === "founding.counter" ? "Founding seats: {n} of 10 still open." : k));
  assert.equal(withN.line, "Founding seats: 7 of 10 still open.");
});

test("one seat left still offers a seat", () => {
  // The boundary that matters: 1 is an offer, 0 is not, and an off-by-one here
  // would either hide the last seat or promise an eleventh.
  assert.equal(foundingCopy(1, tr).offering, true);
  assert.equal(foundingCopy(0, tr).offering, false);
});

test("no seats left: the offer is withdrawn, not merely reworded", () => {
  const c = foundingCopy(0, tr);
  assert.equal(c.line, "founding.gone");
  assert.equal(c.offering, false);
  // Null rather than a translated string: the note and the why-line describe
  // an offer that no longer exists, so the page must drop them rather than
  // print them under a line saying all ten are taken.
  assert.equal(c.note, null);
  assert.equal(c.why, null);
  assert.equal(c.cta, "cta.primary");
});

test("every language can render the counter with a figure in it", () => {
  // The counter is one template with a {n} placeholder rather than a plural
  // form per language, so the placeholder has to survive translation. A file
  // that lost it would silently print a sentence with no number in it — the
  // one thing the counter exists to show.
  const dirUrl = new URL("../locales/", import.meta.url);
  const files = readFileSync(new URL("../index.html", import.meta.url), "utf8")
    .match(/hreflang="([a-z-]+)"/g)
    .map(m => m.slice(10, -1))
    .filter(c => c !== "x-default");

  for (const code of files) {
    const d = JSON.parse(readFileSync(new URL(code + ".json", dirUrl), "utf8"));
    assert.ok(d.founding, `${code}: no founding block`);
    assert.match(d.founding.counter, /\{n\}/, `${code}: counter lost its {n}`);
    for (const k of ["note", "gone", "why"]) {
      assert.equal(typeof d.founding[k], "string", `${code}: founding.${k} missing`);
      assert.ok(d.founding[k].trim().length > 0, `${code}: founding.${k} empty`);
    }
    assert.equal(typeof d.cta.founding, "string", `${code}: cta.founding missing`);

    const line = foundingCopy(7, k => k.split(".").reduce((o, p) => o?.[p], d)).line;
    assert.ok(line.includes("7"), `${code}: rendered counter has no figure: ${line}`);
  }
});

test("the English baked into index.html matches en.json", () => {
  // The site is static, so index.html carries the English sentence itself and
  // app.js repaints it a moment later. If the two ever drift, an English
  // reader watches the line rewrite itself on load -- and nobody editing one
  // of the two files would notice.
  const en = JSON.parse(readFileSync(new URL("../locales/en.json", import.meta.url), "utf8"));
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const decode = s => s.replace(/&rarr;/g, "→").replace(/&amp;/g, "&").trim();
  const grab = re => { const m = html.match(re); return m ? decode(m[1]) : null; };

  assert.equal(grab(/data-founding-line>([^<]*)</), en.founding.counter.replace("{n}", "10"),
    "the counter line in index.html is not what en.json renders at ten");
  assert.equal(grab(/data-founding-note>([^<]*)</), en.founding.note);
  assert.equal(grab(/data-founding-why>([^<]*)</), en.founding.why);

  const ctas = [...html.matchAll(/data-founding-cta[^>]*>([^<]*)</g)].map(m => decode(m[1]));
  assert.ok(ctas.length >= 1, "no founding CTA found in index.html");
  for (const c of ctas) assert.equal(c, en.cta.founding);
});

test("the counter starts at the honest number", () => {
  // Ten, because nothing is reserved and nothing is claimed. An outreach email
  // that quotes a smaller figure is making a claim this page will contradict.
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html.match(/data-founding-line>([^<]*)</)[1], /\b10 of 10\b/);
});
