-- gift.ceo — the founding seats are closed, and the two that exist still stand.
--
-- Run in the Supabase SQL editor (as postgres) after 0012 is applied. One
-- transaction ending in ROLLBACK, so it leaves nothing behind. Every check raises
-- on failure: a run that reaches the end without an error is a run that passed.

begin;

create or replace function pg_temp.ok(cond boolean, msg text)
returns void language plpgsql as $$
begin
  if cond is not true then
    raise exception 'FAIL: %', msg;
  end if;
  raise notice 'ok  - %', msg;
end $$;

select pg_temp.ok(
  (public.claim_founding_seat(gen_random_uuid()) ->> 'granted') = 'false',
  'claim_founding_seat grants nothing');

select pg_temp.ok(
  (public.claim_founding_seat(gen_random_uuid()) ->> 'reason') = 'founding_closed',
  'and says why');

select pg_temp.ok(public.founding_seats_remaining() = 0, 'no founding seat is left to offer');

select pg_temp.ok(
  not exists (select 1 from cron.job where jobname = 'revoke-expired-founding-seats'),
  'nothing is scheduled to revoke a founding seat');

select pg_temp.ok(
  (select count(*) from public.companies
    where is_founding and founding_revoked_at is null and seat_status = 'active') = 2,
  'the two founding companies still hold active seats');

rollback;
