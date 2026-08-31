insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('logos-photos', 'logos-photos', true, 2097152,
        array['image/png','image/jpeg','image/webp','image/svg+xml'])
on conflict (id) do update
  set public = true,
      file_size_limit = 2097152,
      allowed_mime_types = array['image/png','image/jpeg','image/webp','image/svg+xml'];

-- Logos and photos are shown on public pages, so reading is open. Writing is
-- not: a signed-in person may only touch the folder named after their own
-- user id, which stops one company replacing another company's logo.
drop policy if exists "logos read" on storage.objects;
create policy "logos read" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'logos-photos');

drop policy if exists "logos write own" on storage.objects;
create policy "logos write own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'logos-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "logos update own" on storage.objects;
create policy "logos update own" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'logos-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'logos-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "logos delete own" on storage.objects;
create policy "logos delete own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'logos-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
