-- gift.ceo — no more free seats (the owner's decision, 13 September 2026).
--
-- From now on a seat is 10,000 CHF for every company. The two founding
-- companies that already hold a free seat — Cyberbotics Ltd. (#1) and Rotabo
-- (#2) — keep theirs, and keep being seats one and two.
--
-- Closed in the database rather than only on the page. claim-seat still asks
-- claim_founding_seat before it sends anybody to Stripe; the answer is now
-- always no, so no leftover reservation, cached homepage or hand-made request
-- can mint a free seat again, and everyone falls through to the Payment Link.

create or replace function public.claim_founding_seat(p_company_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to public
as $$
begin
  return jsonb_build_object('granted', false, 'reason', 'founding_closed');
end;
$$;

-- Nothing is offered, so nothing is left.
create or replace function public.founding_seats_remaining()
returns integer
language sql
stable
security definer
set search_path to public
as $$
  select 0;
$$;

-- The two founding seats stand for good. The daily revocation only ever touched
-- a founding seat with no gift inside its thirty days — both have given — but
-- with the programme over there is nothing left for it to watch.
do $$
begin
  perform cron.unschedule('revoke-expired-founding-seats');
exception when others then
  null;  -- already gone
end $$;
