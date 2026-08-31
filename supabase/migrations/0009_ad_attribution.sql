-- Recovered from production on 31 August 2026.
--
-- This migration was applied to the gift-ceo project (as
-- `add_ad_attribution_columns`, 20260831134441) but its file never reached the
-- repository, so the schema on disk and the schema in the database had quietly
-- parted company. The text below is the statement list read back out of
-- supabase_migrations.schema_migrations, unchanged. Nothing here is re-run:
-- every statement is `if not exists`, and the columns already exist.
--
-- Ad attribution, split deliberately across two tables.
--
-- page_views gets only the campaign LABELS (utm_*): they say which campaign a
-- visit came from, and say nothing about who the visitor is. The table stays
-- what its function comment promises — no visitor identifier, two visits by one
-- person still indistinguishable from two visits by two people.
--
-- The gclid — which IS a per-click identifier — is written only on companies,
-- and only at the moment somebody claims a seat under their own name and email.
-- That is the one row where identity already exists, so attribution costs no
-- anonymity that was not already given up.

alter table public.page_views
  add column if not exists utm_source   text,
  add column if not exists utm_medium   text,
  add column if not exists utm_campaign text;

alter table public.companies
  add column if not exists gclid         text,
  add column if not exists utm_source    text,
  add column if not exists utm_medium    text,
  add column if not exists utm_campaign  text,
  add column if not exists attributed_at timestamptz;

create index if not exists companies_gclid_idx
  on public.companies (gclid) where gclid is not null;
