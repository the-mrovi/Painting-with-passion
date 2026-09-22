-- Repairs legacy Supabase Auth accounts that do not yet have a user_profiles row.
-- Safe to run repeatedly. Uses only Supabase Free-plan Postgres/Auth features.
-- Replace these placeholders with the approved administrator emails before running.

begin;

insert into private.admin_allowlist (email)
values
  (lower(trim('admin-one@example.com'))),
  (lower(trim('admin-two@example.com')))
on conflict (email) do nothing;

insert into public.user_profiles (id, email, full_name, phone_number, is_admin)
select
  u.id,
  lower(trim(u.email)),
  coalesce(nullif(trim(u.raw_user_meta_data ->> 'full_name'), ''), 'Art Lover'),
  nullif(trim(u.raw_user_meta_data ->> 'phone_number'), ''),
  exists (
    select 1
    from private.admin_allowlist a
    where a.email = lower(trim(u.email))
  )
from auth.users u
where u.email is not null
on conflict (id) do update
set email = excluded.email,
    is_admin = excluded.is_admin,
    updated_at = now();

commit;

-- Verification: the target account must return exactly one row with
-- profile_exists=true, is_admin=true, and is_banned=false.
select
  u.id,
  u.email,
  p.id is not null as profile_exists,
  p.is_admin,
  p.is_banned
from auth.users u
left join public.user_profiles p on p.id = u.id
where lower(trim(u.email)) = lower(trim('admin-one@example.com'));
