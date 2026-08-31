create or replace function public.companies_before_insert()
returns trigger language plpgsql security definer set search_path to public as $$
declare caller_hd text := public.current_hd();
begin
  new.seat_status := 'pending_payment'; new.seat_number := null;
  new.stripe_session_id := null; new.paid_at := null; new.activated_at := null;
  new.created_at := now();
  new.domain := public.normalize_domain(new.website);
  if new.domain is null then raise exception 'A valid company website is required.'; end if;
  if caller_hd is null then raise exception 'Sign in with your company Google Workspace account.'; end if;
  if caller_hd <> new.domain then raise exception 'This website does not match your Google Workspace domain (%).', caller_hd; end if;
  return new;
end; $$;
drop trigger if exists companies_before_insert on public.companies;
create trigger companies_before_insert before insert on public.companies
  for each row execute function public.companies_before_insert();

create or replace function public.companies_after_update()
returns trigger language plpgsql security definer set search_path to public as $$
begin
  if new.seat_status = 'active' and old.seat_status is distinct from 'active' then
    update public.companies
       set activated_at = now(),
           seat_number = coalesce((select max(seat_number) from public.companies), 0) + 1
     where id = new.id and seat_number is null;
  end if;
  return null;
end; $$;
drop trigger if exists companies_after_update on public.companies;
create trigger companies_after_update after update of seat_status on public.companies
  for each row execute function public.companies_after_update();

create or replace function public.ceos_before_insert()
returns trigger language plpgsql security definer set search_path to public as $$
declare caller_hd text := public.current_hd(); company_domain text;
begin
  select domain into company_domain from public.companies where id = new.company_id;
  if company_domain is null then raise exception 'Unknown company.'; end if;
  if caller_hd is null or caller_hd <> company_domain then
    raise exception 'You can only sign for the company your Google Workspace account belongs to.'; end if;
  new.started_at := now(); new.ended_at := null;
  return new;
end; $$;
drop trigger if exists ceos_before_insert on public.ceos;
create trigger ceos_before_insert before insert on public.ceos
  for each row execute function public.ceos_before_insert();

create or replace function public.gifts_before_insert()
returns trigger language plpgsql security definer set search_path to public as $$
declare ok boolean;
begin
  select true into ok from public.ceos c
    join public.companies co on co.id = c.company_id
   where c.user_id = auth.uid() and c.is_current
     and c.company_id = new.company_id and c.id = new.ceo_id
     and co.seat_status = 'active';
  if ok is not true then raise exception 'Only the current CEO of a company with an active seat can give.'; end if;
  new.gift_number := coalesce((select max(gift_number) from public.gifts), 0) + 1;
  new.status := coalesce(new.status,'active'); new.created_at := now(); new.updated_at := now();
  return new;
end; $$;
drop trigger if exists gifts_before_insert on public.gifts;
create trigger gifts_before_insert before insert on public.gifts
  for each row execute function public.gifts_before_insert();

create or replace function public.gifts_before_update()
returns trigger language plpgsql as $$
begin
  new.gift_number := old.gift_number; new.company_id := old.company_id;
  new.ceo_id := old.ceo_id; new.created_at := old.created_at; new.updated_at := now();
  return new;
end; $$;
drop trigger if exists gifts_before_update on public.gifts;
create trigger gifts_before_update before update on public.gifts
  for each row execute function public.gifts_before_update();

create or replace view public.live_companies with (security_invoker = true) as
  select co.id, co.name, co.website, co.country, co.logo_url, co.slug,
         co.seat_number, co.activated_at,
         ce.display_name as ceo_name, ce.photo_url as ceo_photo_url,
         ce.linkedin_url as ceo_linkedin_url
    from public.companies co
    left join public.ceos ce on ce.company_id = co.id and ce.is_current
   where co.seat_status = 'active';

create or replace view public.live_gifts with (security_invoker = true) as
  select g.id, g.gift_number, g.type, g.title, g.description, g.how_to_claim,
         g.link, g.valid_until, g.created_at,
         case when g.status = 'withdrawn' then 'withdrawn'
              when g.valid_until is not null and g.valid_until < current_date then 'ended'
              else 'active' end as state,
         co.name as company_name, co.slug as company_slug,
         co.country as company_country, co.logo_url as company_logo_url,
         ce.display_name as ceo_name
    from public.gifts g
    join public.companies co on co.id = g.company_id
    join public.ceos ce on ce.id = g.ceo_id
   where co.seat_status = 'active';

alter table public.profiles  enable row level security;
alter table public.companies enable row level security;
alter table public.ceos      enable row level security;
alter table public.gifts     enable row level security;

drop policy if exists companies_read_active on public.companies;
create policy companies_read_active on public.companies for select to anon, authenticated
  using (seat_status = 'active');
drop policy if exists ceos_read_public on public.ceos;
create policy ceos_read_public on public.ceos for select to anon, authenticated
  using (exists (select 1 from public.companies co where co.id = ceos.company_id and co.seat_status = 'active'));
drop policy if exists gifts_read_public on public.gifts;
create policy gifts_read_public on public.gifts for select to anon, authenticated
  using (exists (select 1 from public.companies co where co.id = gifts.company_id and co.seat_status = 'active'));
drop policy if exists profiles_self_read on public.profiles;
create policy profiles_self_read on public.profiles for select to authenticated using (user_id = auth.uid());
drop policy if exists companies_insert_own on public.companies;
create policy companies_insert_own on public.companies for insert to authenticated with check (true);
drop policy if exists companies_read_own on public.companies;
create policy companies_read_own on public.companies for select to authenticated
  using (exists (select 1 from public.ceos c where c.company_id = companies.id and c.user_id = auth.uid()));
drop policy if exists companies_update_own on public.companies;
create policy companies_update_own on public.companies for update to authenticated
  using (exists (select 1 from public.ceos c where c.company_id = companies.id and c.user_id = auth.uid() and c.is_current))
  with check (exists (select 1 from public.ceos c where c.company_id = companies.id and c.user_id = auth.uid() and c.is_current));
drop policy if exists ceos_insert_self on public.ceos;
create policy ceos_insert_self on public.ceos for insert to authenticated with check (user_id = auth.uid());
drop policy if exists ceos_read_own on public.ceos;
create policy ceos_read_own on public.ceos for select to authenticated using (user_id = auth.uid());
drop policy if exists ceos_update_self on public.ceos;
create policy ceos_update_self on public.ceos for update to authenticated
  using (user_id = auth.uid() and is_current) with check (user_id = auth.uid() and is_current);
drop policy if exists gifts_insert_own on public.gifts;
create policy gifts_insert_own on public.gifts for insert to authenticated
  with check (exists (select 1 from public.ceos c where c.id = gifts.ceo_id and c.user_id = auth.uid() and c.is_current));
drop policy if exists gifts_update_own on public.gifts;
create policy gifts_update_own on public.gifts for update to authenticated
  using (exists (select 1 from public.ceos c where c.company_id = gifts.company_id and c.user_id = auth.uid() and c.is_current))
  with check (exists (select 1 from public.ceos c where c.company_id = gifts.company_id and c.user_id = auth.uid() and c.is_current));

create or replace function public.companies_guard_update()
returns trigger language plpgsql as $$
begin
  if current_user not in ('service_role','postgres','supabase_admin') then
    new.seat_status := old.seat_status; new.seat_number := old.seat_number;
    new.stripe_session_id := old.stripe_session_id; new.paid_at := old.paid_at;
    new.activated_at := old.activated_at; new.domain := old.domain;
    new.website := old.website; new.slug := old.slug; new.created_at := old.created_at;
  end if;
  return new;
end; $$;
drop trigger if exists companies_guard_update on public.companies;
create trigger companies_guard_update before update on public.companies
  for each row execute function public.companies_guard_update();

create or replace function public.ceos_guard_update()
returns trigger language plpgsql as $$
begin
  if current_user not in ('service_role','postgres','supabase_admin') then
    new.is_current := old.is_current; new.ended_at := old.ended_at;
    new.company_id := old.company_id; new.user_id := old.user_id;
    new.ceo_declared_at := old.ceo_declared_at;
    new.terms_accepted_at := old.terms_accepted_at; new.started_at := old.started_at;
  end if;
  return new;
end; $$;
drop trigger if exists ceos_guard_update on public.ceos;
create trigger ceos_guard_update before update on public.ceos
  for each row execute function public.ceos_guard_update();

grant select on public.live_companies to anon, authenticated;
grant select on public.live_gifts to anon, authenticated;
