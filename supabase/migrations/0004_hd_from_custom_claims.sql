-- Google returns the Workspace domain as `hd`. Supabase copies provider claims
-- it has no column for into raw_user_meta_data.custom_claims, so that is where
-- `hd` actually lands; reading only the top level left every profile with a
-- null hd and made the seat check impossible to pass.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path to public as $$
declare
  claimed_hd text;
begin
  claimed_hd := nullif(lower(btrim(coalesce(
    new.raw_user_meta_data->>'hd',
    new.raw_user_meta_data#>>'{custom_claims,hd}',
    ''
  ))), '');

  insert into public.profiles (user_id, email, hd, full_name, avatar_url)
  values (new.id, new.email, claimed_hd,
          new.raw_user_meta_data->>'full_name',
          new.raw_user_meta_data->>'avatar_url')
  on conflict (user_id) do update set
    email      = excluded.email,
    hd         = coalesce(excluded.hd, public.profiles.hd),
    full_name  = coalesce(excluded.full_name, public.profiles.full_name),
    avatar_url = coalesce(excluded.avatar_url, public.profiles.avatar_url);
  return new;
end; $$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

-- Backfill anyone who signed in before this fix.
update public.profiles p
   set hd = nullif(lower(btrim(coalesce(
         u.raw_user_meta_data->>'hd',
         u.raw_user_meta_data#>>'{custom_claims,hd}', ''))), '')
  from auth.users u
 where u.id = p.user_id and p.hd is null;
