-- gift.ceo — the founding seats, exercised end to end.
--
-- Run in the Supabase SQL editor (as postgres) after 0010 is applied. The whole
-- file is one transaction ending in ROLLBACK, so it leaves nothing behind: no
-- test company, no reservation, no event. Every check raises on failure, so a
-- run that reaches the end without an error is a run that passed.
--
-- Plain SQL rather than pgTAP on purpose -- pgTAP is available on this project
-- but not installed, and a test suite should not require enabling an extension
-- on production to tell you whether production works.

begin;

create or replace function pg_temp.ok(cond boolean, msg text)
returns void language plpgsql as $$
begin
  -- `cond is not true` rather than `not cond`: a scalar subquery that matched
  -- no row hands back NULL, and `if not NULL` raises nothing at all -- a test
  -- that passes precisely when the thing it checks has gone missing.
  if cond is not true then
    raise exception 'FAIL: %', msg;
  end if;
  raise notice 'ok  - %', msg;
end $$;

-- Becomes the signed-in caller. auth.uid() reads request.jwt.claims, which is
-- what claim_founding_seat and current_hd() both come back to.
create or replace function pg_temp.sign_in(p_user uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
                     json_build_object('sub', p_user::text)::text, true);
end $$;

-- A signed-in CEO of a company on `p_domain`, exactly as the join form would
-- have left things: company written, chair taken, nothing paid.
create or replace function pg_temp.make_company(p_domain text, p_name text)
returns uuid language plpgsql as $$
declare
  uid uuid := gen_random_uuid();
  cid uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, raw_user_meta_data)
  values (uid, 'ceo@' || p_domain,
          jsonb_build_object('hd', p_domain, 'full_name', 'Test CEO'));

  perform pg_temp.sign_in(uid);

  insert into public.companies (id, domain, website, name, country, slug)
  values (cid, p_domain, 'https://' || p_domain, p_name, 'CH',
          replace(p_domain, '.', '-'));

  insert into public.ceos (id, user_id, company_id, display_name, is_current,
                           ceo_declared_at, terms_accepted_at)
  values (gen_random_uuid(), uid, cid, 'Test CEO', true, now(), now());

  return cid;
end $$;

-- Whoever currently holds the chair at this company, so a test can sign back
-- in as them after having been someone else.
create or replace function pg_temp.ceo_of(p_company uuid)
returns uuid language sql as $$
  select user_id from public.ceos where company_id = p_company and is_current;
$$;


-- ===========================================================================
-- 1. A domain on the allowlist claims a seat without ever reaching Stripe.
-- ===========================================================================

insert into public.founding_domains (domain, company_name, note)
values ('test-alpha.example', 'Alpha', 'test fixture');

do $$
declare
  cid uuid;
  res jsonb;
  co  public.companies%rowtype;
begin
  cid := pg_temp.make_company('test-alpha.example', 'Alpha');
  res := public.claim_founding_seat(cid);

  perform pg_temp.ok((res->>'granted')::boolean, 'allowlisted domain is granted a seat');
  perform pg_temp.ok((res->>'founding_number')::int = 1, 'first founding seat is number 1');

  select * into co from public.companies where id = cid;
  perform pg_temp.ok(co.is_founding,                'is_founding is set');
  perform pg_temp.ok(co.seat_status = 'active',     'seat is active without payment');
  perform pg_temp.ok(co.paid_at is null,            'nothing was paid');
  perform pg_temp.ok(co.stripe_session_id is null,  'no Stripe session exists');
  perform pg_temp.ok(co.seat_number is not null,    'the ordinary seat number was still handed out');
  perform pg_temp.ok(
    co.founding_deadline between now() + interval '29 days' and now() + interval '31 days',
    'the deadline is thirty days out');
  perform pg_temp.ok(
    exists (select 1 from public.founding_domains
             where domain = 'test-alpha.example' and claimed_by_company_id = cid),
    'the allowlist row is marked claimed');
  perform pg_temp.ok(
    exists (select 1 from public.founding_events
             where company_id = cid and event = 'granted'),
    'the grant is logged');
end $$;


-- ===========================================================================
-- 2. A domain that is not on the allowlist gets nothing, and is left in the
--    state the paid flow expects to find it in.
-- ===========================================================================

do $$
declare
  cid uuid;
  res jsonb;
  co  public.companies%rowtype;
begin
  cid := pg_temp.make_company('test-stranger.example', 'Stranger');
  res := public.claim_founding_seat(cid);

  perform pg_temp.ok(not (res->>'granted')::boolean, 'unlisted domain is refused');
  perform pg_temp.ok(res->>'reason' = 'not_reserved', 'and told why: not_reserved');

  select * into co from public.companies where id = cid;
  perform pg_temp.ok(not co.is_founding,                 'no founding flag was set');
  perform pg_temp.ok(co.seat_status = 'pending_payment', 'still waiting to pay, as claim-seat expects');
end $$;


-- ===========================================================================
-- 3. The eleventh reserved domain is refused a free seat and falls through.
--    This is the one that decides whether "ten" means anything.
-- ===========================================================================

do $$
declare
  i    int;
  dom  text;
  cid  uuid;
  res  jsonb;
begin
  -- Nine more, filling the pool to ten with Alpha from test 1.
  for i in 2..10 loop
    dom := 'test-seat' || i || '.example';
    insert into public.founding_domains (domain, company_name, note)
    values (dom, 'Seat ' || i, 'test fixture');
    cid := pg_temp.make_company(dom, 'Seat ' || i);
    res := public.claim_founding_seat(cid);
    perform pg_temp.ok((res->>'granted')::boolean, 'seat ' || i || ' granted');
  end loop;

  perform pg_temp.ok(public.founding_seats_remaining() = 0, 'the counter reads zero at ten');

  -- The eleventh: on the list, and still refused.
  insert into public.founding_domains (domain, company_name, note)
  values ('test-eleventh.example', 'Eleventh', 'test fixture');
  cid := pg_temp.make_company('test-eleventh.example', 'Eleventh');
  res := public.claim_founding_seat(cid);

  perform pg_temp.ok(not (res->>'granted')::boolean, 'the eleventh reserved domain is refused');
  perform pg_temp.ok(res->>'reason' = 'pool_empty',  'and told why: pool_empty');
  perform pg_temp.ok(
    (select seat_status from public.companies where id = cid) = 'pending_payment',
    'the eleventh falls through to the paid flow');
  perform pg_temp.ok(
    exists (select 1 from public.founding_events
             where company_id = cid and event = 'refused_pool_empty'),
    'the refusal is logged');
end $$;


-- ===========================================================================
-- 4. The counter clamps and counts.
-- ===========================================================================

do $$
begin
  perform pg_temp.ok(public.founding_seats_remaining() = 0, 'ten taken reads 0');

  -- Revoke three by hand and the counter must follow.
  update public.companies set founding_revoked_at = now()
   where founding_number in (8, 9, 10) and is_founding;
  perform pg_temp.ok(public.founding_seats_remaining() = 3, 'three revoked reads 3');

  update public.companies set founding_revoked_at = null
   where founding_number in (8, 9, 10) and is_founding;
  perform pg_temp.ok(public.founding_seats_remaining() = 0, 'restored reads 0 again');
end $$;


-- ===========================================================================
-- 5. Thirty-one days, no gift: the seat is revoked and its number reused.
-- ===========================================================================

do $$
declare
  victim   uuid;
  vnumber  int;
  revoked  int;
  cid      uuid;
  res      jsonb;
begin
  select id, founding_number into victim, vnumber
    from public.companies where founding_number = 4 and is_founding;

  update public.companies
     set founding_claimed_at = now() - interval '31 days',
         founding_deadline   = now() - interval '1 day'
   where id = victim;

  revoked := public.revoke_expired_founding_seats();
  perform pg_temp.ok(revoked = 1, 'exactly one seat expired');

  perform pg_temp.ok(
    (select founding_revoked_at is not null from public.companies where id = victim),
    'the lapsed seat is marked revoked');
  perform pg_temp.ok(
    (select seat_status from public.companies where id = victim) = 'suspended',
    'and suspended, which is what actually stops it giving');
  perform pg_temp.ok(
    exists (select 1 from public.founding_domains
             where domain = 'test-seat4.example' and claimed_by_company_id is null),
    'its reservation is back in the pool');
  perform pg_temp.ok(
    exists (select 1 from public.founding_events
             where company_id = victim and event = 'revoked'),
    'the revocation is logged');
  perform pg_temp.ok(public.founding_seats_remaining() = 1, 'one seat is free again');

  -- And the freed number is what the next company takes, not eleven.
  insert into public.founding_domains (domain, company_name, note)
  values ('test-next.example', 'Next', 'test fixture');
  cid := pg_temp.make_company('test-next.example', 'Next');
  res := public.claim_founding_seat(cid);

  perform pg_temp.ok((res->>'granted')::boolean, 'the next company is granted a seat');
  perform pg_temp.ok((res->>'founding_number')::int = vnumber,
                     'and takes the freed number ' || vnumber || ', not an eleventh');
end $$;


-- ===========================================================================
-- 6. One gift on day 29, untouched on day 31.
-- ===========================================================================

do $$
declare
  keeper uuid;
  ceo    uuid;
  before_status text;
begin
  select id into keeper from public.companies where founding_number = 5 and is_founding;
  ceo := pg_temp.ceo_of(keeper);
  perform pg_temp.sign_in(ceo);

  -- Given on day 29, inside the window.
  insert into public.gifts (id, company_id, ceo_id, type, title, description)
  values (gen_random_uuid(), keeper,
          (select id from public.ceos where company_id = keeper and is_current),
          'world', 'A tool, free', 'Given on day twenty-nine.');

  -- Now it is day 31.
  update public.companies
     set founding_claimed_at = now() - interval '31 days',
         founding_deadline   = now() - interval '1 day'
   where id = keeper;

  select seat_status into before_status from public.companies where id = keeper;
  perform public.revoke_expired_founding_seats();

  perform pg_temp.ok(
    (select founding_revoked_at is null from public.companies where id = keeper),
    'a company that gave inside the window keeps its seat past the deadline');
  perform pg_temp.ok(
    (select seat_status from public.companies where id = keeper) = before_status,
    'and its seat status is untouched');
end $$;


-- ===========================================================================
-- 7. A paid seat is never revoked, whatever else is true of it.
-- ===========================================================================

do $$
declare
  cid uuid;
begin
  insert into public.founding_domains (domain, company_name, note)
  values ('test-paid.example', 'Paid', 'test fixture');
  cid := pg_temp.make_company('test-paid.example', 'Paid');

  -- A row that looks exactly like an expired founding seat, except that money
  -- changed hands. The expiry must not touch it.
  update public.companies
     set is_founding       = true,
         founding_number   = null,
         founding_deadline = now() - interval '10 days',
         seat_status       = 'active',
         paid_at           = now() - interval '40 days'
   where id = cid;

  perform public.revoke_expired_founding_seats();

  perform pg_temp.ok(
    (select founding_revoked_at is null from public.companies where id = cid),
    'a paid seat survives the expiry pass');
  perform pg_temp.ok(
    (select seat_status from public.companies where id = cid) = 'active',
    'and stays active');
end $$;


-- ===========================================================================
-- 8. A client cannot assert that it is founding, on the way in or afterwards.
-- ===========================================================================

do $$
declare
  uid uuid := gen_random_uuid();
  cid uuid := gen_random_uuid();
  co  public.companies%rowtype;
begin
  insert into auth.users (id, email, raw_user_meta_data)
  values (uid, 'ceo@test-forger.example',
          jsonb_build_object('hd', 'test-forger.example', 'full_name', 'Forger'));
  perform pg_temp.sign_in(uid);

  -- Insert claiming everything it is not entitled to.
  insert into public.companies (id, domain, website, name, country, slug,
                                is_founding, founding_number, seat_status, paid_at)
  values (cid, 'test-forger.example', 'https://test-forger.example', 'Forger', 'CH',
          'test-forger-example', true, 3, 'active', now());

  select * into co from public.companies where id = cid;
  perform pg_temp.ok(not co.is_founding,                 'a forged is_founding is stripped on insert');
  perform pg_temp.ok(co.founding_number is null,         'a forged founding_number is stripped');
  perform pg_temp.ok(co.seat_status = 'pending_payment', 'a forged seat_status is stripped');
  perform pg_temp.ok(co.paid_at is null,                 'a forged paid_at is stripped');

  -- The chair, so the update below is one RLS actually permits. Without it
  -- companies_update_own refuses the statement outright and the assertions
  -- pass without the guard trigger ever having been asked anything.
  insert into public.ceos (id, user_id, company_id, display_name, is_current,
                           ceo_declared_at, terms_accepted_at)
  values (gen_random_uuid(), uid, cid, 'Forger', true, now(), now());

  -- And afterwards, as a signed-in user rather than the service role.
  set local role authenticated;
  update public.companies
     set name = 'Forger renamed', is_founding = true,
         founding_number = 3, seat_status = 'active'
   where id = cid;
  reset role;

  select * into co from public.companies where id = cid;
  perform pg_temp.ok(co.name = 'Forger renamed',
                     'the update really went through -- the name changed');

  select * into co from public.companies where id = cid;
  perform pg_temp.ok(not co.is_founding,                 'a later forged is_founding is put back');
  perform pg_temp.ok(co.founding_number is null,         'a later forged founding_number is put back');
  perform pg_temp.ok(co.seat_status = 'pending_payment', 'a later forged seat_status is put back');
end $$;


-- ===========================================================================
-- 9. The allowlist is not readable by anyone who is not the operator.
-- ===========================================================================

do $$
declare
  visible int;
  denied  boolean;
begin
  -- Two ways to be unreadable and both are correct: the grant was revoked, so
  -- the read is refused outright; or RLS is reached and returns nothing
  -- because there is no policy. The test accepts either and insists on one.
  begin
    denied := false;
    set local role anon;
    select count(*) into visible from public.founding_domains;
    reset role;
  exception when insufficient_privilege then
    denied := true;
    reset role;
  end;
  perform pg_temp.ok(denied or visible = 0, 'anon cannot read the allowlist');

  begin
    denied := false;
    set local role authenticated;
    select count(*) into visible from public.founding_domains;
    reset role;
  exception when insufficient_privilege then
    denied := true;
    reset role;
  end;
  perform pg_temp.ok(denied or visible = 0, 'nor can a signed-in user');

  -- The counter, by contrast, is exactly what anon is meant to have.
  set local role anon;
  perform public.founding_seats_remaining();
  reset role;
  perform pg_temp.ok(true, 'anon may call founding_seats_remaining()');
end $$;


rollback;
