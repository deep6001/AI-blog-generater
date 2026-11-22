-- Super admins and per-user access control.
-- Super admins manage users through the server (service role key); nobody can grant themselves
-- admin rights or re-enable their own access from the browser.

alter table public.profiles
  add column if not exists is_super_admin boolean not null default false,
  add column if not exists is_disabled    boolean not null default false;

-- Users may still edit their own name, avatar, workspace choice and preferences, but not these flags.
revoke update on public.profiles from anon, authenticated;
grant update (display_name, avatar_url, current_tenant_id, preferences) on public.profiles to authenticated;

-- True when the signed-in user has been disabled by an admin.
create or replace function public.is_disabled_user() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_disabled from public.profiles where id = auth.uid()), false);
$$;

-- A disabled user's still-valid session token can't read or change any data. Restrictive policies
-- are combined with AND, so they apply on top of every existing policy on each table.
do $$
declare t text;
begin
  foreach t in array array[
    'profiles', 'tenants', 'tenant_members', 'projects', 'sessions',
    'research_runs', 'usage_records', 'guideline_profiles', 'qa_reviews'
  ] loop
    execute format('drop policy if exists "disabled users have no access" on public.%I', t);
    execute format(
      'create policy "disabled users have no access" on public.%I as restrictive for all to authenticated using (not public.is_disabled_user()) with check (not public.is_disabled_user())',
      t
    );
  end loop;
end $$;
