-- Replace these placeholders with the approved administrator emails before running.
-- The allowlist trigger safely updates existing accounts and future registrations.
insert into private.admin_allowlist (email)
values
  (lower('admin-one@example.com')),
  (lower('admin-two@example.com'))
on conflict (email) do nothing;
