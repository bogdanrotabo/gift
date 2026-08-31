-- gift.ceo — the ten founding seats.
--
-- The 10,000 CHF is a filter: only a CEO who means it will pay to give in
-- public under their own name. The first ten pass a different filter. They pay
-- nothing and give first, while the page is still empty and there is nobody to
-- be seen standing next to. The obligation replaces the money: publish a gift
-- within thirty days or the seat goes back in the pool.
--
-- Two things here are deliberately not left to the browser. Whether a domain
-- is entitled to a free seat is decided against the Workspace `hd` claim the
-- database already trusts, and the allowlist itself is never readable by
-- anyone: a visitor who could list it would know which companies were
-- approached before they had answered.

-- ------------------------------------------------------ companies: the seat

alter table public.companies
  add column if not exists is_founding         boolean not null default false,
  add column if not exists founding_number     integer,
  add column if not exists founding_claimed_at timestamptz,
  add column if not exists founding_deadline   timestamptz,
  add column if not exists founding_revoked_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'companies_founding_number_range'
  ) then
    alter table public.companies
      add constraint companies_founding_number_range
      check (founding_number is null or founding_number between 1 and 10);
  end if;
end $$;

-- Unique among the seats that still stand, not across all history. A revoked
-- company keeps the number it held -- the admin query reads better when the
-- row still says which seat it was -- and the number is free again the moment
-- the seat is revoked, which is what lets the next company take it.
create unique index if not exists companies_founding_number_live
  on public.companies (founding_number)
  where founding_number is not null and founding_revoked_at is null;

create index if not exists companies_founding_due_idx
  on public.companies (founding_deadline)
  where is_founding and founding_revoked_at is null;

-- The guard trigger from 0001 puts money-side columns back on any update that
-- did not come from the service role. The founding columns belong in the same
-- set: a company may correct its name, never its own seat.
create or replace function public.companies_guard_update()
returns trigger
language plpgsql
-- Pinned in 0003, and it has to be repeated here: CREATE OR REPLACE keeps a
-- function's ownership and permissions but replaces everything else, so a
-- replacement that omits this line silently unpins the search_path again.
set search_path to public
as $$
begin
  if current_user not in ('service_role','postgres','supabase_admin') then
    new.seat_status         := old.seat_status;
    new.seat_number         := old.seat_number;
    new.stripe_session_id   := old.stripe_session_id;
    new.paid_at             := old.paid_at;
    new.activated_at        := old.activated_at;
    new.domain              := old.domain;
    new.website             := old.website;
    new.slug                := old.slug;
    new.created_at          := old.created_at;
    new.is_founding         := old.is_founding;
    new.founding_number     := old.founding_number;
    new.founding_claimed_at := old.founding_claimed_at;
    new.founding_deadline   := old.founding_deadline;
    new.founding_revoked_at := old.founding_revoked_at;
  end if;
  return new;
end;
$$;

-- Same reasoning on the way in: a client may create its company, but not
-- create it already holding a founding seat.
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

  new.is_founding         := false;
  new.founding_number     := null;
  new.founding_claimed_at := null;
  new.founding_deadline   := null;
  new.founding_revoked_at := null;

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

-- ------------------------------------------------------------- the allowlist

-- Filled in by hand, one row per company that answered an email and asked for
-- a seat. A row with claimed_by_company_id still null is a reservation: that
-- domain may take a free seat the next time it signs in.
create table if not exists public.founding_domains (
  domain                text primary key,
  company_name          text,
  reserved_at           timestamptz not null default now(),
  claimed_by_company_id uuid references public.companies(id) on delete set null,
  note                  text
);

-- Bare host, lowercase, no scheme and no www -- the shape Google's hd claim
-- arrives in. Normalising on the way in means a row typed as
-- "https://www.Proton.me/" still matches the claim that says "proton.me".
create or replace function public.founding_domains_before_write()
returns trigger
language plpgsql
security definer
set search_path to public
as $$
begin
  new.domain := public.normalize_domain(new.domain);
  if new.domain is null then
    raise exception 'A founding domain must be a bare host, e.g. proton.me';
  end if;
  return new;
end;
$$;

drop trigger if exists founding_domains_before_write on public.founding_domains;
create trigger founding_domains_before_write
  before insert or update of domain on public.founding_domains
  for each row execute function public.founding_domains_before_write();

-- ------------------------------------------------------------------- the log

create table if not exists public.founding_events (
  id         bigint generated always as identity primary key,
  company_id uuid references public.companies(id) on delete set null,
  domain     text,
  event      text not null,
  detail     jsonb,
  at         timestamptz not null default now()
);

create index if not exists founding_events_at_idx on public.founding_events (at desc);

-- --------------------------------------------------------------- the counter

-- The single integer the outside world is allowed to know. Security definer
-- because the honest count includes a founding company whose seat is not yet
-- active, and anon can only see active ones -- without this the counter would
-- briefly overstate what is left.
create or replace function public.founding_seats_remaining()
returns integer
language sql
stable
security definer
set search_path to public
as $$
  select greatest(0, 10 - (
    select count(*)::int
      from public.companies
     where is_founding and founding_revoked_at is null
  ));
$$;

-- ----------------------------------------------------------------- the claim

-- Called with the caller's own token, never the service role, so `current_hd()`
-- is the Workspace domain Google vouched for and nothing the caller typed.
-- There is no argument by which a client can assert that it is founding: it
-- names a company, and every other fact is looked up.
create or replace function public.claim_founding_seat(p_company_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to public
as $$
declare
  caller_hd  text := public.current_hd();
  co         public.companies%rowtype;
  reserved   public.founding_domains%rowtype;
  next_no    integer;
  remaining  integer;
begin
  if caller_hd is null then
    return jsonb_build_object('granted', false, 'reason', 'no_workspace_domain');
  end if;

  select * into co from public.companies where id = p_company_id;
  if co.id is null then
    return jsonb_build_object('granted', false, 'reason', 'unknown_company');
  end if;

  -- The seat follows the domain, so the caller must be signing in on the very
  -- domain the company was registered under.
  if co.domain is distinct from caller_hd then
    return jsonb_build_object('granted', false, 'reason', 'domain_mismatch');
  end if;

  -- And must be the person currently holding the company's chair.
  if not exists (
    select 1 from public.ceos c
     where c.company_id = co.id and c.user_id = auth.uid() and c.is_current
  ) then
    return jsonb_build_object('granted', false, 'reason', 'not_current_ceo');
  end if;

  if co.seat_status = 'active' then
    return jsonb_build_object('granted', false, 'reason', 'already_active');
  end if;

  -- Two CEOs signing in at the same second must not both be told they got the
  -- tenth seat. Everything from the count to the write happens behind one
  -- lock, released when the transaction ends.
  perform pg_advisory_xact_lock(hashtext('gift.ceo:founding-seats'));

  select * into reserved
    from public.founding_domains
   where domain = caller_hd and claimed_by_company_id is null;

  if reserved.domain is null then
    return jsonb_build_object('granted', false, 'reason', 'not_reserved');
  end if;

  remaining := public.founding_seats_remaining();
  if remaining <= 0 then
    -- The eleventh reserved domain is not refused its seat by accident. It
    -- falls through to the ordinary 10,000 CHF, which is the whole point of
    -- there being exactly ten.
    insert into public.founding_events (company_id, domain, event, detail)
    values (co.id, caller_hd, 'refused_pool_empty', jsonb_build_object('remaining', remaining));
    return jsonb_build_object('granted', false, 'reason', 'pool_empty');
  end if;

  -- The lowest free number, not the highest plus one: a seat revoked at
  -- number three is taken by the next company as number three.
  select min(n) into next_no
    from generate_series(1, 10) as n
   where not exists (
     select 1 from public.companies c2
      where c2.founding_number = n and c2.founding_revoked_at is null
   );

  if next_no is null then
    return jsonb_build_object('granted', false, 'reason', 'pool_empty');
  end if;

  -- seat_status last: the after-update trigger from 0001 hands out the
  -- ordinary seat_number the moment it turns active, and a founding company
  -- takes its place in that sequence like any other.
  update public.companies
     set is_founding         = true,
         founding_number     = next_no,
         founding_claimed_at = now(),
         founding_deadline   = now() + interval '30 days',
         founding_revoked_at = null,
         seat_status         = 'active'
   where id = co.id;

  update public.founding_domains
     set claimed_by_company_id = co.id
   where domain = reserved.domain;

  insert into public.founding_events (company_id, domain, event, detail)
  values (co.id, caller_hd, 'granted',
          jsonb_build_object('founding_number', next_no,
                             'deadline', (now() + interval '30 days')));

  return jsonb_build_object(
    'granted', true,
    'founding_number', next_no,
    'deadline', (now() + interval '30 days')
  );
end;
$$;

-- ---------------------------------------------------------------- the expiry

-- A founding seat is the only kind that can be lost, and only one way: by
-- never being used. Publishing once, at any point inside the thirty days,
-- settles it for good.
create or replace function public.revoke_expired_founding_seats()
returns integer
language plpgsql
security definer
set search_path to public
as $$
declare
  r       record;
  n       integer := 0;
begin
  perform pg_advisory_xact_lock(hashtext('gift.ceo:founding-seats'));

  for r in
    select co.id, co.domain, co.founding_number
      from public.companies co
     where co.is_founding
       and co.founding_revoked_at is null
       and co.paid_at is null                    -- a paid seat is never revoked
       and co.founding_deadline is not null
       and co.founding_deadline < now()
       and not exists (select 1 from public.gifts g where g.company_id = co.id)
  loop
    -- Suspended, not merely flagged: gifts_before_insert lets only an active
    -- seat give, so this is what actually closes the door. The row and its
    -- number stay, so the record of who held seat three survives.
    update public.companies
       set founding_revoked_at = now(),
           seat_status         = 'suspended'
     where id = r.id;

    update public.founding_domains
       set claimed_by_company_id = null
     where claimed_by_company_id = r.id;

    insert into public.founding_events (company_id, domain, event, detail)
    values (r.id, r.domain, 'revoked',
            jsonb_build_object('founding_number', r.founding_number,
                               'reason', 'no gift within 30 days'));

    n := n + 1;
  end loop;

  return n;
end;
$$;

-- ------------------------------------------------------------- admin readout

-- One row per founding seat, in seat order. Readable only by the service role
-- and the SQL editor -- it joins the allowlist, which nobody else may see.
create or replace view public.founding_seats_state as
  select
    co.founding_number,
    fd.domain            as reserved_domain,
    co.domain            as company_domain,
    co.name              as company_name,
    co.seat_status,
    co.founding_claimed_at,
    co.founding_deadline,
    co.founding_revoked_at,
    (select count(*) from public.gifts g where g.company_id = co.id) as gift_count
  from public.companies co
  left join public.founding_domains fd on fd.claimed_by_company_id = co.id
  where co.is_founding
  order by co.founding_number;

-- --------------------------------------------------------------------- RLS

-- The allowlist is the one table with no policy at all. RLS on plus nothing
-- granted means anon and authenticated get an empty set, whatever they ask:
-- a company that was approached and has not answered is not public knowledge.
alter table public.founding_domains enable row level security;
alter table public.founding_events  enable row level security;

revoke all on public.founding_domains from anon, authenticated;
revoke all on public.founding_events  from anon, authenticated;
revoke all on public.founding_seats_state from anon, authenticated;

-- The counter, and only the counter.
grant execute on function public.founding_seats_remaining() to anon, authenticated;
grant execute on function public.claim_founding_seat(uuid)  to authenticated;

-- PostgREST publishes every function in `public` as an RPC endpoint, and 0003
-- established that anything not meant for a client gets its endpoint taken
-- away. The expiry runs on a schedule and the normaliser is a trigger, so
-- neither is anyone's to call.
revoke all on function public.revoke_expired_founding_seats()
  from public, anon, authenticated;
revoke all on function public.founding_domains_before_write()
  from public, anon, authenticated;

-- ------------------------------------------------------------------ schedule

-- Daily at 03:00 UTC. Nothing is time-critical here -- a seat that expired at
-- midnight is revoked three hours later, and the pool is a day's grace either
-- way -- so a single quiet-hours pass is enough.
create extension if not exists pg_cron;

do $$
begin
  perform cron.unschedule('revoke-expired-founding-seats');
exception when others then
  null;  -- not scheduled yet, which is the normal case on a first run
end $$;

select cron.schedule(
  'revoke-expired-founding-seats',
  '0 3 * * *',
  $job$ select public.revoke_expired_founding_seats(); $job$
);
