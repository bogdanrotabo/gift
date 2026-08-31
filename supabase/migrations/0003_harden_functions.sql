-- Pin search_path on the four functions that were missing it.
alter function public.normalize_domain(text)      set search_path to public;
alter function public.gifts_before_update()       set search_path to public;
alter function public.companies_guard_update()    set search_path to public;
alter function public.ceos_guard_update()         set search_path to public;

-- PostgREST publishes every function in `public` as an RPC endpoint. None of
-- these are meant to be called by a client: the trigger functions run when the
-- table fires them (which does not check EXECUTE), and current_hd() is an
-- internal helper. Take the endpoints away.
do $$
declare f text;
begin
  foreach f in array array[
    'public.normalize_domain(text)',
    'public.current_hd()',
    'public.handle_new_user()',
    'public.companies_before_insert()',
    'public.companies_after_update()',
    'public.companies_guard_update()',
    'public.ceos_before_insert()',
    'public.ceos_guard_update()',
    'public.gifts_before_insert()',
    'public.gifts_before_update()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $$;
