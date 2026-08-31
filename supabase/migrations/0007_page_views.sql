-- gift.ceo — the counter behind the admin's traffic view.
--
-- Deliberately thin: a path, a moment, a country, and the site that sent the
-- visit. No cookie is set, no visitor identifier is minted, and no IP address
-- is stored. Two visits by one person are indistinguishable from two visits by
-- two people, which is the point — this answers "is anyone arriving, and from
-- where", not "who is arriving". The register's promise in privacy.html is
-- that analytics are announced before they are switched on, and that page is
-- updated in the same commit as this table.
--
-- Nothing reaches this table through the API. RLS is enabled and no policy is
-- ever created, which in Postgres means every ordinary role is refused; only
-- the service role bypasses it, and only two edge functions hold that: `track`
-- writes a view, `admin-overview` reads them back.

create table if not exists public.page_views (
  id         bigint generated always as identity primary key,
  path       text not null,
  ref_host   text,
  country    text,
  lang       text,
  created_at timestamptz not null default now()
);

-- The admin view reads a recent window newest-first and groups by day, so the
-- descending index on created_at is the one that matters.
create index if not exists page_views_created_idx on public.page_views (created_at desc);

alter table public.page_views enable row level security;

-- No policies, on purpose. See the note above: absence of a policy is the
-- lock, not an oversight.
