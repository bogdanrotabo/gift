-- Two policies were reading each other's tables: companies_read_own asked
-- ceos, and ceos_read_public asked companies. Each read re-entered the other's
-- policy, and Postgres stopped it with "infinite recursion detected in policy".
-- Anything a signed-in CEO tried to load would have failed outright — the
-- dashboard, the pending-seat screen, the join page's own-company lookup.
--
-- The fix is to answer those questions with security-definer helpers, which
-- run as the owner and so do not re-enter RLS. They live in a private schema
-- rather than public: PostgREST publishes public, and these are not meant to
-- be callable endpoints — only readable by the policies that use them. The
-- grants are required even so, because a policy is evaluated as the caller.

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to anon, authenticated;

create or replace function private.company_is_live(cid uuid)
returns boolean language sql stable security definer set search_path to public as $$
  select exists (select 1 from public.companies where id = cid and seat_status = 'active');
$$;

create or replace function private.is_ceo_of(cid uuid)
returns boolean language sql stable security definer set search_path to public as $$
  select exists (select 1 from public.ceos where company_id = cid and user_id = auth.uid());
$$;

create or replace function private.is_current_ceo_of(cid uuid)
returns boolean language sql stable security definer set search_path to public as $$
  select exists (
    select 1 from public.ceos
     where company_id = cid and user_id = auth.uid() and is_current
  );
$$;

create or replace function private.owns_current_ceo_row(ceo uuid)
returns boolean language sql stable security definer set search_path to public as $$
  select exists (
    select 1 from public.ceos
     where id = ceo and user_id = auth.uid() and is_current
  );
$$;

grant execute on function
  private.company_is_live(uuid),
  private.is_ceo_of(uuid),
  private.is_current_ceo_of(uuid),
  private.owns_current_ceo_row(uuid)
to anon, authenticated;

drop policy if exists ceos_read_public on public.ceos;
create policy ceos_read_public on public.ceos for select to anon, authenticated
  using (private.company_is_live(company_id));

drop policy if exists gifts_read_public on public.gifts;
create policy gifts_read_public on public.gifts for select to anon, authenticated
  using (private.company_is_live(company_id));

drop policy if exists companies_read_own on public.companies;
create policy companies_read_own on public.companies for select to authenticated
  using (private.is_ceo_of(id));

drop policy if exists companies_update_own on public.companies;
create policy companies_update_own on public.companies for update to authenticated
  using (private.is_current_ceo_of(id))
  with check (private.is_current_ceo_of(id));

drop policy if exists gifts_insert_own on public.gifts;
create policy gifts_insert_own on public.gifts for insert to authenticated
  with check (private.owns_current_ceo_row(ceo_id));

drop policy if exists gifts_update_own on public.gifts;
create policy gifts_update_own on public.gifts for update to authenticated
  using (private.is_current_ceo_of(company_id))
  with check (private.is_current_ceo_of(company_id));
