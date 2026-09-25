-- Safe public artwork previews and transactional availability enforcement.
-- Run this once in the Supabase SQL editor for an existing installation.

begin;

alter table public.paintings
  add column if not exists is_available boolean not null default true;

create or replace function public.get_public_paintings(p_painting_id uuid default null)
returns table (
  id uuid,
  title text,
  storage_path text,
  story_preview text,
  has_more_story boolean,
  medium text,
  dimensions text,
  price numeric,
  currency text,
  is_available boolean,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with visible as (
    select
      p.*,
      coalesce(nullif(trim(p.description), ''), nullif(trim(p.caption), ''), 'No story has been added for this work yet.') as story_text
    from public.paintings p
    where p.published = true
      and (p_painting_id is null or p.id = p_painting_id)
  )
  select
    v.id,
    v.title,
    v.storage_path,
    array_to_string((regexp_split_to_array(v.story_text, '\s+'))[1:32], ' ') as story_preview,
    cardinality(regexp_split_to_array(v.story_text, '\s+')) > 32 as has_more_story,
    v.medium,
    v.dimensions,
    v.price,
    v.currency,
    v.is_available,
    v.created_at
  from visible v
  order by v.created_at desc;
$$;

revoke all on function public.get_public_paintings(uuid) from public;
grant execute on function public.get_public_paintings(uuid) to anon, authenticated;

create or replace function public.is_published_artwork_path(p_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.paintings p
    where p.storage_path = p_path and p.published = true
  );
$$;

revoke all on function public.is_published_artwork_path(text) from public;
grant execute on function public.is_published_artwork_path(text) to anon, authenticated;

drop policy if exists "published_artwork_public_read" on storage.objects;
create policy "published_artwork_public_read" on storage.objects for select to anon
using (bucket_id = 'artworks' and (select public.is_published_artwork_path(name)));

drop policy if exists "cart_owner_insert" on public.cart_items;
create policy "cart_owner_insert" on public.cart_items for insert to authenticated with check (
  (select auth.uid()) = user_id
  and (select private.is_active_user())
  and not (select private.is_admin())
  and exists (
    select 1 from public.paintings p
    where p.id = painting_id and p.published and p.is_available and p.price is not null
  )
);

drop policy if exists "comments_member_insert" on public.comments;
create policy "comments_member_insert" on public.comments for insert to authenticated
with check (
  (select auth.uid()) = user_id
  and (select private.is_active_user())
  and exists (select 1 from public.thoughts t where t.id = thought_id and t.published = true)
);

drop policy if exists "thought_likes_member_insert" on public.thought_likes;
create policy "thought_likes_member_insert" on public.thought_likes for insert to authenticated
with check (
  (select auth.uid()) = user_id
  and (select private.is_active_user())
  and exists (select 1 from public.thoughts t where t.id = thought_id and t.published = true)
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
  unavailable_titles text;
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
    select string_agg(p.title, ', ' order by p.title)
    into unavailable_titles
    from public.cart_items c
    join public.paintings p on p.id = c.painting_id
    where c.user_id = current_user_id
      and not (p.published = true and p.is_available = true and p.price is not null);
    raise exception 'No longer available: %', coalesce(unavailable_titles, 'one or more artworks');
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

commit;
