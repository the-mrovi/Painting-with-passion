-- Targeted patch for secure admin provisioning and customer-only ordering.
-- Uses only Supabase Auth, Postgres, RLS, and Storage features available on Free.
-- Replace these placeholders with the approved administrator emails before running.

insert into private.admin_allowlist (email)
values
  (lower('admin-one@example.com')),
  (lower('admin-two@example.com'))
on conflict (email) do nothing;

drop policy if exists "cart_owner_select" on public.cart_items;
drop policy if exists "cart_owner_insert" on public.cart_items;
drop policy if exists "cart_owner_delete" on public.cart_items;

create policy "cart_owner_select" on public.cart_items for select to authenticated
using (
  (select auth.uid()) = user_id
  and (select private.is_active_user())
  and not (select private.is_admin())
);

create policy "cart_owner_insert" on public.cart_items for insert to authenticated
with check (
  (select auth.uid()) = user_id
  and (select private.is_active_user())
  and not (select private.is_admin())
  and exists (
    select 1 from public.paintings p
    where p.id = painting_id and p.published and p.is_available and p.price is not null
  )
);

create policy "cart_owner_delete" on public.cart_items for delete to authenticated
using (
  (select auth.uid()) = user_id
  and (select private.is_active_user())
  and not (select private.is_admin())
);

create or replace function public.place_order(
  p_full_name text,
  p_email text,
  p_phone text,
  p_address_line text,
  p_city text,
  p_postal_code text default null,
  p_country text default 'Bangladesh',
  p_payment_method text default 'studio_confirmation',
  p_payment_reference text default null,
  p_customer_note text default null
)
returns table (order_id uuid, order_number text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  new_order_id uuid := gen_random_uuid();
  new_order_number text := 'PWP-' || to_char(now(), 'YYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
  cart_count integer;
  available_count integer;
  order_subtotal numeric(12,2);
  order_currency text;
begin
  if current_user_id is null or not (select private.is_active_user()) then
    raise exception 'A valid account is required to place an order';
  end if;
  if (select private.is_admin()) then
    raise exception 'Admin accounts cannot place customer orders';
  end if;
  if nullif(trim(p_full_name), '') is null
     or nullif(trim(p_email), '') is null
     or nullif(trim(p_phone), '') is null
     or nullif(trim(p_address_line), '') is null
     or nullif(trim(p_city), '') is null then
    raise exception 'Please complete the required contact and delivery fields';
  end if;
  if p_payment_method not in ('studio_confirmation', 'mobile_transfer') then
    raise exception 'Unsupported payment method';
  end if;

  perform 1
  from public.paintings p
  join public.cart_items c on c.painting_id = p.id
  where c.user_id = current_user_id
  for update of p;

  select count(*) into cart_count
  from public.cart_items c
  where c.user_id = current_user_id;

  select count(*), coalesce(sum(p.price), 0), min(p.currency)
  into available_count, order_subtotal, order_currency
  from public.cart_items c
  join public.paintings p on p.id = c.painting_id
  where c.user_id = current_user_id
    and p.published = true
    and p.is_available = true
    and p.price is not null;

  if cart_count = 0 then
    raise exception 'Your cart is empty';
  end if;
  if available_count <> cart_count then
    raise exception 'One or more artworks are no longer available';
  end if;
  if exists (
    select 1
    from public.cart_items c
    join public.paintings p on p.id = c.painting_id
    where c.user_id = current_user_id and p.currency <> order_currency
  ) then
    raise exception 'All artworks in one order must use the same currency';
  end if;

  insert into public.orders (
    id, order_number, user_id, full_name, email, phone, address_line, city,
    postal_code, country, payment_method, payment_reference, customer_note,
    subtotal, shipping_fee, total, currency
  ) values (
    new_order_id, new_order_number, current_user_id, trim(p_full_name), lower(trim(p_email)),
    trim(p_phone), trim(p_address_line), trim(p_city), nullif(trim(p_postal_code), ''),
    coalesce(nullif(trim(p_country), ''), 'Bangladesh'), p_payment_method,
    nullif(trim(p_payment_reference), ''), nullif(trim(p_customer_note), ''),
    order_subtotal, 0, order_subtotal, order_currency
  );

  insert into public.order_items (
    order_id, painting_id, artwork_name, artwork_storage_path, medium,
    dimensions, unit_price, quantity
  )
  select new_order_id, p.id, p.title, p.storage_path, p.medium,
         p.dimensions, p.price, 1
  from public.cart_items c
  join public.paintings p on p.id = c.painting_id
  where c.user_id = current_user_id;

  update public.paintings p
  set is_available = false
  where p.id in (
    select c.painting_id from public.cart_items c where c.user_id = current_user_id
  );

  delete from public.cart_items c where c.user_id = current_user_id;

  return query select new_order_id, new_order_number;
end;
$$;

revoke all on function public.place_order(text, text, text, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.place_order(text, text, text, text, text, text, text, text, text, text) to authenticated;
