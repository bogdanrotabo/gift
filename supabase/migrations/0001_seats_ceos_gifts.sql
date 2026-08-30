-- gift.ceo — seats, CEOs, gifts.
--
-- The whole design rests on one fact: a Google Workspace sign-in carries an
-- `hd` claim naming the domain the account belongs to. That claim is the only
-- proof of company we have, so it is checked in the database and not only in
-- the browser. A seat belongs to a domain, never to a person: when the CEO
-- leaves, the next one signs in on the same domain and takes it over.

-- ---------------------------------------------------------------- helpers

-- Strips scheme, www. and anything after the host, so "https://www.ACME.com/x"
-- and "acme.com" are the same company. Returns null for empty input rather
-- than an empty string, so a missing website fails a NOT NULL check loudly.
create or replace function public.normalize_domain(raw text)
returns text
language sql
immutable
as $$
  select nullif(
    substring(
      regexp_replace(
        regexp_replace(lower(btrim(coalesce(raw, ''))), '^[a-z]+://', ''),
        '^www\.', ''
      )
      from '^[^/:?#]+'
    ),
    ''
  );
$$;

-- The caller's Workspace domain, read from their profile rather than the raw
-- JWT: the profile is written once by a trigger we control, so a client
-- cannot shape it.
create or replace function public.current_hd()
returns text
language sql
stable
security definer
set search_path to public
as $$
  select hd from public.profiles where user_id = auth.uid();
$$;

-- --------------------------------------------------------------- profiles

create table if not exists public.profiles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text,
  hd         text,
  full_name  text,
  avatar_url text,
  created_at timestamptz not null default now()
);

create index if not exists profiles_hd_idx on public.profiles (hd);

-- Google puts `hd` in the identity payload. Mirroring it here at sign-in is
-- what lets every later check be a cheap local read.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to public
as $$
begin
  insert into public.profiles (user_id, email, hd, full_name, avatar_url)
  values (
    new.id,
    new.email,
    nullif(lower(coalesce(new.raw_user_meta_data->>'hd', '')), ''),
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (user_id) do update set
    email      = excluded.email,
    hd         = coalesce(excluded.hd, public.profiles.hd),
    full_name  = coalesce(excluded.full_name, public.profiles.full_name),
    avatar_url = coalesce(excluded.avatar_url, public.profiles.avatar_url);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert or update of raw_user_meta_data, email on auth.users
  for each row execute function public.handle_new_user();

-- -------------------------------------------------------------- companies

create table if not exists public.companies (
  id                uuid primary key,
  domain            text not null unique,
  name              text not null,
  website           text not null,
  country           text not null,          -- ISO alpha-2
  logo_url          text,
  slug              text not null unique,
  seat_status       text not null default 'pending_payment'
                      check (seat_status in ('pending_payment','active','suspended')),
  seat_number       integer unique,
  stripe_session_id text unique,
  created_at        timestamptz not null default now(),
  paid_at           timestamptz,
  activated_at      timestamptz,
  constraint companies_country_len check (char_length(country) = 2)
);

-- A client may name its company and its website. It may not name its own
-- seat status, its number, or a Stripe session: those are the parts money
-- decides, so they are stripped on the way in whatever the client sent.
create or replace function public.companies_before_insert()
returns trigger
language plpgsql
security definer
set search_path to public
as $$
declare
  caller_hd text := public.current_hd();
begin
  new.seat_status       := 'pending_payment';
  new.seat_number       := null;
  new.stripe_session_id := null;
  new.paid_at           := null;
  new.activated_at      := null;
  new.created_at        := now();

  new.domain := public.normalize_domain(new.website);
  if new.domain is null then
    raise exception 'A valid company website is required.';
  end if;

  if caller_hd is null then
    raise exception 'Sign in with your company Google Workspace account.';
  end if;

  if caller_hd <> new.domain then
    raise exception 'This website does not match your Google Workspace domain (%).', caller_hd;
  end if;

  return new;
end;
$$;

drop trigger if exists companies_before_insert on public.companies;
create trigger companies_before_insert
  before insert on public.companies
  for each row execute function public.companies_before_insert();

-- The seat number is handed out when the money lands, not when the row is
-- written, so #1 is the first company that actually paid.
create or replace function public.companies_after_update()
returns trigger
language plpgsql
security definer
set search_path to public
as $$
begin
  if new.seat_status = 'active' and old.seat_status is distinct from 'active' then
    update public.companies
       set activated_at = now(),
           seat_number  = coalesce((select max(seat_number) from public.companies), 0) + 1
     where id = new.id
       and seat_number is null;
  end if;
  return null;
end;
$$;

drop trigger if exists companies_after_update on public.companies;
create trigger companies_after_update
  after update of seat_status on public.companies
  for each row execute function public.companies_after_update();

-- ------------------------------------------------------------------- ceos

create table if not exists public.ceos (
  id                uuid primary key,
  user_id           uuid not null references public.profiles(user_id) on delete restrict,
  company_id        uuid not null references public.companies(id) on delete restrict,
  display_name      text not null,
  linkedin_url      text,
  photo_url         text,
  is_current        boolean not null default true,
  ceo_declared_at   timestamptz not null,
  terms_accepted_at timestamptz not null,
  started_at        timestamptz not null default now(),
  ended_at          timestamptz
);

-- One sitting CEO per company. Past ones stay in the table, which is how a
-- gift keeps the name of whoever actually gave it.
create unique index if not exists ceos_one_current_per_company
  on public.ceos (company_id) where is_current;

create index if not exists ceos_company_idx on public.ceos (company_id);
create index if not exists ceos_user_idx    on public.ceos (user_id);

create or replace function public.ceos_before_insert()
returns trigger
language plpgsql
security definer
set search_path to public
as $$
declare
  caller_hd     text := public.current_hd();
  company_domain text;
begin
  select domain into company_domain from public.companies where id = new.company_id;

  if company_domain is null then
    raise exception 'Unknown company.';
  end if;
  if caller_hd is null or caller_hd <> company_domain then
    raise exception 'You can only sign for the company your Google Workspace account belongs to.';
  end if;

  new.started_at := now();
  new.ended_at   := null;
  return new;
end;
$$;

drop trigger if exists ceos_before_insert on public.ceos;
create trigger ceos_before_insert
  before insert on public.ceos
  for each row execute function public.ceos_before_insert();

-- ------------------------------------------------------------------ gifts

create table if not exists public.gifts (
  id           uuid primary key,
  company_id   uuid not null references public.companies(id) on delete restrict,
  ceo_id       uuid not null references public.ceos(id) on delete restrict,
  type         text not null check (type in ('world','team','equity','mentoring')),
  title        text not null check (char_length(title) between 1 and 120),
  description  text not null check (char_length(description) between 1 and 3000),
  how_to_claim text check (how_to_claim is null or char_length(how_to_claim) <= 1000),
  link         text,
  valid_until  date,
  status       text not null default 'active' check (status in ('active','withdrawn')),
  gift_number  integer unique,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists gifts_company_idx on public.gifts (company_id);
create index if not exists gifts_number_idx  on public.gifts (gift_number);

-- Only the sitting CEO of a paid-up company may give, and the number is the
-- order of giving. Both are decided here so no client can choose either.
create or replace function public.gifts_before_insert()
returns trigger
language plpgsql
security definer
set search_path to public
as $$
declare
  ok boolean;
begin
  select true into ok
    from public.ceos c
    join public.companies co on co.id = c.company_id
   where c.user_id = auth.uid()
     and c.is_current
     and c.company_id = new.company_id
     and c.id = new.ceo_id
     and co.seat_status = 'active';

  if ok is not true then
    raise exception 'Only the current CEO of a company with an active seat can give.';
  end if;

  new.gift_number := coalesce((select max(gift_number) from public.gifts), 0) + 1;
  new.status      := coalesce(new.status, 'active');
  new.created_at  := now();
  new.updated_at  := now();
  return new;
end;
$$;

drop trigger if exists gifts_before_insert on public.gifts;
create trigger gifts_before_insert
  before insert on public.gifts
  for each row execute function public.gifts_before_insert();

create or replace function public.gifts_before_update()
returns trigger
language plpgsql
as $$
begin
  new.gift_number := old.gift_number;
  new.company_id  := old.company_id;
  new.ceo_id      := old.ceo_id;
  new.created_at  := old.created_at;
  new.updated_at  := now();
  return new;
end;
$$;

drop trigger if exists gifts_before_update on public.gifts;
create trigger gifts_before_update
  before update on public.gifts
  for each row execute function public.gifts_before_update();

-- ------------------------------------------------------- views for anon

-- Expiry is read, never written: a gift whose date has passed becomes
-- "ended" the moment the clock passes it, with no job to run and nothing to
-- go stale.
create or replace view public.live_companies
with (security_invoker = true) as
  select
    co.id,
    co.name,
    co.website,
    co.country,
    co.logo_url,
    co.slug,
    co.seat_number,
    co.activated_at,
    ce.display_name as ceo_name,
    ce.photo_url    as ceo_photo_url,
    ce.linkedin_url as ceo_linkedin_url
  from public.companies co
  left join public.ceos ce
    on ce.company_id = co.id and ce.is_current
  where co.seat_status = 'active';

create or replace view public.live_gifts
with (security_invoker = true) as
  select
    g.id,
    g.gift_number,
    g.type,
    g.title,
    g.description,
    g.how_to_claim,
    g.link,
    g.valid_until,
    g.created_at,
    case
      when g.status = 'withdrawn' then 'withdrawn'
      when g.valid_until is not null and g.valid_until < current_date then 'ended'
      else 'active'
    end as state,
    co.name    as company_name,
    co.slug    as company_slug,
    co.country as company_country,
    co.logo_url as company_logo_url,
    ce.display_name as ceo_name
  from public.gifts g
  join public.companies co on co.id = g.company_id
  join public.ceos ce      on ce.id = g.ceo_id
  where co.seat_status = 'active';

-- ---------------------------------------------------------------- RLS

alter table public.profiles  enable row level security;
alter table public.companies enable row level security;
alter table public.ceos      enable row level security;
alter table public.gifts     enable row level security;

-- Anonymous readers see the two views and nothing else. The views are
-- security_invoker, so these policies are what make them readable.
drop policy if exists companies_read_active on public.companies;
create policy companies_read_active on public.companies
  for select to anon, authenticated
  using (seat_status = 'active');

drop policy if exists ceos_read_public on public.ceos;
create policy ceos_read_public on public.ceos
  for select to anon, authenticated
  using (exists (
    select 1 from public.companies co
     where co.id = ceos.company_id and co.seat_status = 'active'
  ));

drop policy if exists gifts_read_public on public.gifts;
create policy gifts_read_public on public.gifts
  for select to anon, authenticated
  using (exists (
    select 1 from public.companies co
     where co.id = gifts.company_id and co.seat_status = 'active'
  ));

-- A signed-in user reads and edits only their own profile.
drop policy if exists profiles_self_read on public.profiles;
create policy profiles_self_read on public.profiles
  for select to authenticated using (user_id = auth.uid());

-- Onboarding: the triggers above decide whether the row is allowed at all,
-- so the policy only has to say "a signed-in person may try".
drop policy if exists companies_insert_own on public.companies;
create policy companies_insert_own on public.companies
  for insert to authenticated with check (true);

-- A company that has not paid yet must still be visible to the person who
-- just created it, otherwise the dashboard cannot poll for activation.
drop policy if exists companies_read_own on public.companies;
create policy companies_read_own on public.companies
  for select to authenticated
  using (exists (
    select 1 from public.ceos c
     where c.company_id = companies.id and c.user_id = auth.uid()
  ));

-- The name, country and logo are the company's to correct. The seat is not.
drop policy if exists companies_update_own on public.companies;
create policy companies_update_own on public.companies
  for update to authenticated
  using (exists (
    select 1 from public.ceos c
     where c.company_id = companies.id and c.user_id = auth.uid() and c.is_current
  ))
  with check (exists (
    select 1 from public.ceos c
     where c.company_id = companies.id and c.user_id = auth.uid() and c.is_current
  ));

drop policy if exists ceos_insert_self on public.ceos;
create policy ceos_insert_self on public.ceos
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists ceos_read_own on public.ceos;
create policy ceos_read_own on public.ceos
  for select to authenticated using (user_id = auth.uid());

drop policy if exists ceos_update_self on public.ceos;
create policy ceos_update_self on public.ceos
  for update to authenticated
  using (user_id = auth.uid() and is_current)
  with check (user_id = auth.uid() and is_current);

drop policy if exists gifts_insert_own on public.gifts;
create policy gifts_insert_own on public.gifts
  for insert to authenticated with check (
    exists (
      select 1 from public.ceos c
       where c.id = gifts.ceo_id and c.user_id = auth.uid() and c.is_current
    )
  );

drop policy if exists gifts_update_own on public.gifts;
create policy gifts_update_own on public.gifts
  for update to authenticated
  using (exists (
    select 1 from public.ceos c
     where c.company_id = gifts.company_id and c.user_id = auth.uid() and c.is_current
  ))
  with check (exists (
    select 1 from public.ceos c
     where c.company_id = gifts.company_id and c.user_id = auth.uid() and c.is_current
  ));

-- No DELETE policy anywhere, on purpose: a gift that was given is not taken
-- back, only ended.

-- Columns the client must never move. Postgres has no per-column RLS, so the
-- guard is a trigger that puts the money-side columns back the way it found
-- them on any update that did not come from the service role.
create or replace function public.companies_guard_update()
returns trigger
language plpgsql
as $$
begin
  if current_user not in ('service_role','postgres','supabase_admin') then
    new.seat_status       := old.seat_status;
    new.seat_number       := old.seat_number;
    new.stripe_session_id := old.stripe_session_id;
    new.paid_at           := old.paid_at;
    new.activated_at      := old.activated_at;
    new.domain            := old.domain;
    new.website           := old.website;
    new.slug              := old.slug;
    new.created_at        := old.created_at;
  end if;
  return new;
end;
$$;

drop trigger if exists companies_guard_update on public.companies;
create trigger companies_guard_update
  before update on public.companies
  for each row execute function public.companies_guard_update();

create or replace function public.ceos_guard_update()
returns trigger
language plpgsql
as $$
begin
  if current_user not in ('service_role','postgres','supabase_admin') then
    new.is_current        := old.is_current;
    new.ended_at          := old.ended_at;
    new.company_id        := old.company_id;
    new.user_id           := old.user_id;
    new.ceo_declared_at   := old.ceo_declared_at;
    new.terms_accepted_at := old.terms_accepted_at;
    new.started_at        := old.started_at;
  end if;
  return new;
end;
$$;

drop trigger if exists ceos_guard_update on public.ceos;
create trigger ceos_guard_update
  before update on public.ceos
  for each row execute function public.ceos_guard_update();

grant select on public.live_companies to anon, authenticated;
grant select on public.live_gifts     to anon, authenticated;
