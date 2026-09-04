-- The owner is told when a seat is paid for.
--
-- A seat becomes real in exactly one place: stripe-webhook sets
-- seat_status to 'active' after Stripe's signature has been verified.
-- Hanging the announcement on that transition means it fires for a
-- payment that actually cleared, and for nothing else -- not for a
-- checkout opened and abandoned, not for a row claim-seat wrote while
-- somebody was still typing.
--
-- The mail is sent by rotabo.app's `notify` function, the one place with
-- a sending account and a verified sending domain. This site sends it
-- only the company's id; the function reads the rest back through
-- alerta_plata() below, so nothing an outsider could POST ends up in the
-- text of an email.
--
-- The trigger runs after the row is written and cannot fail the update
-- that carries the payment: pg_net only queues the request, and anything
-- that goes wrong here becomes a warning in the log.

create extension if not exists pg_net;

create or replace function public.alerta_plata(p_ref uuid)
returns jsonb
language sql
security definer
set search_path = ''
stable
as $fn$
  select jsonb_build_object(
    -- gift.ceo records no amount against a company: what was paid is the
    -- seat price at the time, and it lives in Stripe. The alert says what
    -- happened, and the dashboard says what it was worth.
    'amount_cents', null,
    'currency',     null,
    'what',         coalesce(c.name, c.domain, '?'),
    'lines',        jsonb_build_array(
      'company:    ' || coalesce(c.name, '-'),
      'domain:     ' || coalesce(c.domain, '-'),
      'country:    ' || coalesce(c.country, '-'),
      'website:    ' || coalesce(c.website, '-'),
      'seat:       #' || coalesce(c.seat_number::text, '?'),
      'founding:   ' || case when c.is_founding then '#' || coalesce(c.founding_number::text, '?') else 'no' end,
      'session:    ' || coalesce(c.stripe_session_id, '-'),
      'page:       https://gift.ceo/' || coalesce(c.slug, '')
    )
  )
  from public.companies c
  where c.id = p_ref
    and c.seat_status = 'active'
    and coalesce(c.paid_at, c.activated_at) > now() - interval '30 minutes';
$fn$;

-- Anon may call it: the caller is rotabo.app's notify function, holding
-- this site's publishable key and a uuid it could only have got from
-- here. Everything returned is already printed on the company's own page.
revoke all on function public.alerta_plata(uuid) from public;
grant execute on function public.alerta_plata(uuid) to anon, authenticated, service_role;

create or replace function public.anunta_plata()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  perform net.http_post(
    url     := 'https://caqfbpzwdgnwjoaedjrg.supabase.co/functions/v1/notify',
    body    := jsonb_build_object('kind', 'payment', 'site', 'gift.ceo', 'ref', new.id),
    headers := jsonb_build_object('Content-Type', 'application/json')
  );
  return new;
exception when others then
  raise warning 'anunta_plata failed for %: %', new.id, sqlerrm;
  return new;
end;
$fn$;

revoke all on function public.anunta_plata() from public, anon, authenticated;

-- Both ways a seat can become active: the ordinary one, where the webhook
-- flips a pending row, and a row that arrives active already.
drop trigger if exists anunta_plata on public.companies;
create trigger anunta_plata
  after update on public.companies
  for each row
  when (old.seat_status is distinct from new.seat_status and new.seat_status = 'active')
  execute function public.anunta_plata();

drop trigger if exists anunta_plata_noua on public.companies;
create trigger anunta_plata_noua
  after insert on public.companies
  for each row
  when (new.seat_status = 'active')
  execute function public.anunta_plata();
