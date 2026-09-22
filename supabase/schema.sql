-- Painting with passion — Supabase schema
-- Run this as a single migration. Admin email addresses are intentionally not
-- hard-coded; add them with the statement in supabase/admin-setup.example.sql.

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists private.admin_allowlist (
  email text primary key,
  created_at timestamptz not null default now(),
  constraint admin_allowlist_email_lowercase check (email = lower(email))
);

alter table public.user_profiles
  add column if not exists email text,
  add column if not exists is_banned boolean not null default false,
  add column if not exists banned_at timestamptz,
  add column if not exists ban_reason text,
  add column if not exists updated_at timestamptz not null default now();

alter table public.user_profiles alter column is_admin set default false;
update public.user_profiles set is_admin = false where is_admin is null;
alter table public.user_profiles alter column is_admin set not null;

update public.user_profiles p
set email = u.email
from auth.users u
where u.id = p.id and p.email is null;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.user_profiles p
      where p.id = (select auth.uid())
        and p.is_admin = true
        and p.is_banned = false
    );
$$;

create or replace function private.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.user_profiles p
      where p.id = (select auth.uid())
        and p.is_banned = false
    );
$$;

revoke all on function private.is_admin() from public, anon;
revoke all on function private.is_active_user() from public, anon;
grant execute on function private.is_admin() to authenticated;
grant execute on function private.is_active_user() to authenticated;

create or replace function private.sync_auth_user_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.user_profiles (id, email, full_name, phone_number, is_admin)
  values (
    new.id,
    lower(new.email),
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), 'Art Lover'),
    nullif(trim(new.raw_user_meta_data ->> 'phone_number'), ''),
    exists (
      select 1 from private.admin_allowlist a
      where a.email = lower(new.email)
    )
  )
  on conflict (id) do update
  set email = excluded.email,
      is_admin = excluded.is_admin,
      updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_profile_sync on auth.users;
create trigger on_auth_user_profile_sync
after insert or update of email on auth.users
for each row execute procedure private.sync_auth_user_profile();

create or replace function private.sync_admin_allowlist()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.user_profiles p
  set is_admin = exists (
        select 1 from private.admin_allowlist a
        where a.email = lower(p.email)
      ),
      updated_at = now();
  return coalesce(new, old);
end;
$$;

drop trigger if exists on_admin_allowlist_sync on private.admin_allowlist;
create trigger on_admin_allowlist_sync
after insert or update or delete on private.admin_allowlist
for each statement execute procedure private.sync_admin_allowlist();

-- Backfill accounts that were created before the profile-sync trigger existed.
-- Without this, legacy Auth users can sign in but RLS treats them as inactive.
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

drop trigger if exists user_profiles_touch_updated_at on public.user_profiles;
create trigger user_profiles_touch_updated_at
before update on public.user_profiles
for each row execute procedure private.touch_updated_at();

create table if not exists public.thought_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint thought_categories_name_length check (char_length(trim(name)) between 1 and 60)
);

create table if not exists public.thoughts (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  excerpt text,
  content text not null,
  category_id uuid references public.thought_categories(id) on delete set null,
  read_time integer not null default 1,
  published boolean not null default true,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint thoughts_title_length check (char_length(trim(title)) between 1 and 180),
  constraint thoughts_content_length check (char_length(trim(content)) between 1 and 50000),
  constraint thoughts_read_time_positive check (read_time > 0)
);

create table if not exists public.paintings (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  storage_path text not null,
  caption text,
  description text,
  medium text,
  dimensions text,
  price numeric(12,2),
  currency text not null default 'BDT',
  is_available boolean not null default true,
  published boolean not null default true,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint paintings_title_length check (char_length(trim(title)) between 1 and 180),
  constraint paintings_price_nonnegative check (price is null or price >= 0),
  constraint paintings_currency_code check (currency ~ '^[A-Z]{3}$')
);

create table if not exists public.highlight_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint highlight_categories_name_length check (char_length(trim(name)) between 1 and 60)
);

create table if not exists public.highlights (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.highlight_categories(id) on delete cascade,
  media_type text not null,
  storage_path text not null,
  caption text,
  published boolean not null default true,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint highlights_media_type check (media_type in ('image', 'video')),
  constraint highlights_caption_words check (
    caption is null
    or trim(caption) = ''
    or cardinality(regexp_split_to_array(trim(caption), '\s+')) <= 100
  )
);

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  thought_id uuid not null references public.thoughts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  author_name text not null default 'Art Lover',
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint comments_content_length check (char_length(trim(content)) between 1 and 2000)
);

create table if not exists public.thought_likes (
  thought_id uuid not null references public.thoughts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (thought_id, user_id)
);

create table if not exists public.painting_likes (
  painting_id uuid not null references public.paintings(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (painting_id, user_id)
);

create table if not exists public.highlight_likes (
  highlight_id uuid not null references public.highlights(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (highlight_id, user_id)
);

create table if not exists public.cart_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  painting_id uuid not null references public.paintings(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, painting_id)
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  user_id uuid not null references auth.users(id) on delete restrict,
  status text not null default 'pending',
  full_name text not null,
  email text not null,
  phone text not null,
  address_line text not null,
  city text not null,
  postal_code text,
  country text not null default 'Bangladesh',
  payment_method text not null default 'studio_confirmation',
  payment_reference text,
  customer_note text,
  subtotal numeric(12,2) not null,
  shipping_fee numeric(12,2) not null default 0,
  total numeric(12,2) not null,
  currency text not null default 'BDT',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orders_status check (status in ('pending', 'confirmed', 'paid', 'preparing', 'shipped', 'completed', 'cancelled')),
  constraint orders_payment_method check (payment_method in ('studio_confirmation', 'mobile_transfer')),
  constraint orders_totals_nonnegative check (subtotal >= 0 and shipping_fee >= 0 and total >= 0)
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  painting_id uuid references public.paintings(id) on delete set null,
  artwork_name text not null,
  artwork_storage_path text,
  medium text,
  dimensions text,
  unit_price numeric(12,2) not null,
  quantity integer not null default 1,
  line_total numeric(12,2) generated always as (unit_price * quantity) stored,
  created_at timestamptz not null default now(),
  constraint order_items_price_nonnegative check (unit_price >= 0),
  constraint order_items_quantity_positive check (quantity > 0)
);

create table if not exists public.activity_events (
  id bigint generated always as identity primary key,
  event_type text not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  entity_type text,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint activity_events_type check (event_type in (
    'user_registered', 'thought_liked', 'painting_liked', 'highlight_liked',
    'comment_created', 'order_created', 'artwork_created', 'thought_created', 'highlight_created'
  ))
);

create index if not exists thoughts_category_created_idx on public.thoughts (category_id, created_at desc);
create index if not exists thoughts_published_created_idx on public.thoughts (published, created_at desc);
create index if not exists thoughts_created_by_idx on public.thoughts (created_by);
create index if not exists paintings_published_created_idx on public.paintings (published, created_at desc);
create index if not exists paintings_created_by_idx on public.paintings (created_by);
create index if not exists highlights_category_created_idx on public.highlights (category_id, created_at);
create index if not exists highlights_created_by_idx on public.highlights (created_by);
create index if not exists comments_thought_created_idx on public.comments (thought_id, created_at desc);
create index if not exists comments_user_id_idx on public.comments (user_id);
create index if not exists thought_likes_user_id_idx on public.thought_likes (user_id);
create index if not exists painting_likes_user_id_idx on public.painting_likes (user_id);
create index if not exists highlight_likes_user_id_idx on public.highlight_likes (user_id);
create index if not exists cart_items_painting_id_idx on public.cart_items (painting_id);
create index if not exists orders_user_created_idx on public.orders (user_id, created_at desc);
create index if not exists orders_status_created_idx on public.orders (status, created_at desc);
create index if not exists order_items_order_id_idx on public.order_items (order_id);
create index if not exists order_items_painting_id_idx on public.order_items (painting_id);
create index if not exists activity_events_created_idx on public.activity_events (created_at desc);
create index if not exists activity_events_actor_idx on public.activity_events (actor_user_id);

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'thought_categories', 'thoughts', 'paintings', 'highlight_categories',
    'highlights', 'comments', 'orders'
  ] loop
    execute format('drop trigger if exists %I_touch_updated_at on public.%I', table_name, table_name);
    execute format(
      'create trigger %I_touch_updated_at before update on public.%I for each row execute procedure private.touch_updated_at()',
      table_name, table_name
    );
  end loop;
end;
$$;

create or replace function private.set_comment_author()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.user_id := (select auth.uid());
  select coalesce(nullif(trim(p.full_name), ''), 'Art Lover')
  into new.author_name
  from public.user_profiles p
  where p.id = new.user_id;
  new.author_name := coalesce(new.author_name, 'Art Lover');
  return new;
end;
$$;

drop trigger if exists comments_set_author on public.comments;
create trigger comments_set_author
before insert on public.comments
for each row execute procedure private.set_comment_author();

create or replace function private.log_activity_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'user_profiles' then
    insert into public.activity_events (event_type, actor_user_id, entity_type, entity_id, metadata)
    values ('user_registered', new.id, 'user', new.id, jsonb_build_object('name', new.full_name));
  elsif tg_table_name = 'comments' then
    insert into public.activity_events (event_type, actor_user_id, entity_type, entity_id, metadata)
    values ('comment_created', new.user_id, 'thought', new.thought_id, jsonb_build_object('author', new.author_name));
  elsif tg_table_name = 'thought_likes' then
    insert into public.activity_events (event_type, actor_user_id, entity_type, entity_id)
    values ('thought_liked', new.user_id, 'thought', new.thought_id);
  elsif tg_table_name = 'painting_likes' then
    insert into public.activity_events (event_type, actor_user_id, entity_type, entity_id)
    values ('painting_liked', new.user_id, 'painting', new.painting_id);
  elsif tg_table_name = 'highlight_likes' then
    insert into public.activity_events (event_type, actor_user_id, entity_type, entity_id)
    values ('highlight_liked', new.user_id, 'highlight', new.highlight_id);
  elsif tg_table_name = 'orders' then
    insert into public.activity_events (event_type, actor_user_id, entity_type, entity_id, metadata)
    values ('order_created', new.user_id, 'order', new.id, jsonb_build_object('order_number', new.order_number, 'total', new.total, 'currency', new.currency));
  elsif tg_table_name = 'paintings' then
    insert into public.activity_events (event_type, actor_user_id, entity_type, entity_id, metadata)
    values ('artwork_created', new.created_by, 'painting', new.id, jsonb_build_object('title', new.title));
  elsif tg_table_name = 'thoughts' then
    insert into public.activity_events (event_type, actor_user_id, entity_type, entity_id, metadata)
    values ('thought_created', new.created_by, 'thought', new.id, jsonb_build_object('title', new.title));
  elsif tg_table_name = 'highlights' then
    insert into public.activity_events (event_type, actor_user_id, entity_type, entity_id)
    values ('highlight_created', new.created_by, 'highlight', new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists activity_user_registered on public.user_profiles;
create trigger activity_user_registered after insert on public.user_profiles
for each row execute procedure private.log_activity_event();
drop trigger if exists activity_comment_created on public.comments;
create trigger activity_comment_created after insert on public.comments
for each row execute procedure private.log_activity_event();
drop trigger if exists activity_thought_liked on public.thought_likes;
create trigger activity_thought_liked after insert on public.thought_likes
for each row execute procedure private.log_activity_event();
drop trigger if exists activity_painting_liked on public.painting_likes;
create trigger activity_painting_liked after insert on public.painting_likes
for each row execute procedure private.log_activity_event();
drop trigger if exists activity_highlight_liked on public.highlight_likes;
create trigger activity_highlight_liked after insert on public.highlight_likes
for each row execute procedure private.log_activity_event();
drop trigger if exists activity_order_created on public.orders;
create trigger activity_order_created after insert on public.orders
for each row execute procedure private.log_activity_event();
drop trigger if exists activity_artwork_created on public.paintings;
create trigger activity_artwork_created after insert on public.paintings
for each row execute procedure private.log_activity_event();
drop trigger if exists activity_thought_created on public.thoughts;
create trigger activity_thought_created after insert on public.thoughts
for each row execute procedure private.log_activity_event();
drop trigger if exists activity_highlight_created on public.highlights;
create trigger activity_highlight_created after insert on public.highlights
for each row execute procedure private.log_activity_event();

create or replace function public.get_like_summary(p_content_type text, p_content_id uuid)
returns table (like_count bigint, liked boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare current_user_id uuid := (select auth.uid());
begin
  if p_content_type = 'thought' then
    return query select count(*)::bigint, exists (
      select 1 from public.thought_likes l where l.thought_id = p_content_id and l.user_id = current_user_id
    ) from public.thought_likes l where l.thought_id = p_content_id;
  elsif p_content_type = 'painting' then
    return query select count(*)::bigint, exists (
      select 1 from public.painting_likes l where l.painting_id = p_content_id and l.user_id = current_user_id
    ) from public.painting_likes l where l.painting_id = p_content_id;
  elsif p_content_type = 'highlight' then
    return query select count(*)::bigint, exists (
      select 1 from public.highlight_likes l where l.highlight_id = p_content_id and l.user_id = current_user_id
    ) from public.highlight_likes l where l.highlight_id = p_content_id;
  else
    raise exception 'Unsupported content type';
  end if;
end;
$$;

revoke all on function public.get_like_summary(text, uuid) from public;
grant execute on function public.get_like_summary(text, uuid) to anon, authenticated;

create or replace function public.set_user_ban(p_user_id uuid, p_banned boolean, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select private.is_admin()) then
    raise exception 'Admin access required';
  end if;
  if p_user_id = (select auth.uid()) then
    raise exception 'You cannot ban your own account';
  end if;
  update public.user_profiles
  set is_banned = p_banned,
      banned_at = case when p_banned then now() else null end,
      ban_reason = case when p_banned then nullif(trim(p_reason), '') else null end
  where id = p_user_id and is_admin = false;
end;
$$;

revoke all on function public.set_user_ban(uuid, boolean, text) from public, anon;
grant execute on function public.set_user_ban(uuid, boolean, text) to authenticated;

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

create or replace function private.sync_cancelled_order_availability()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'cancelled' and old.status <> 'cancelled' then
    update public.paintings p
    set is_available = true
    where p.id in (select oi.painting_id from public.order_items oi where oi.order_id = new.id)
      and not exists (
        select 1
        from public.order_items other_item
        join public.orders other_order on other_order.id = other_item.order_id
        where other_item.painting_id = p.id
          and other_order.id <> new.id
          and other_order.status <> 'cancelled'
      );
  elsif old.status = 'cancelled' and new.status <> 'cancelled' then
    update public.paintings p
    set is_available = false
    where p.id in (select oi.painting_id from public.order_items oi where oi.order_id = new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists orders_sync_cancelled_availability on public.orders;
create trigger orders_sync_cancelled_availability
after update of status on public.orders
for each row execute procedure private.sync_cancelled_order_availability();

alter table public.user_profiles enable row level security;
alter table public.thought_categories enable row level security;
alter table public.thoughts enable row level security;
alter table public.paintings enable row level security;
alter table public.highlight_categories enable row level security;
alter table public.highlights enable row level security;
alter table public.comments enable row level security;
alter table public.thought_likes enable row level security;
alter table public.painting_likes enable row level security;
alter table public.highlight_likes enable row level security;
alter table public.cart_items enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.activity_events enable row level security;

create policy "profiles_select_self_or_admin" on public.user_profiles for select to authenticated
using ((select auth.uid()) = id or (select private.is_admin()));
create policy "profiles_update_self" on public.user_profiles for update to authenticated
using ((select auth.uid()) = id and is_banned = false)
with check ((select auth.uid()) = id and is_banned = false);

create policy "thought_categories_public_read" on public.thought_categories for select to anon, authenticated using (true);
create policy "thought_categories_admin_insert" on public.thought_categories for insert to authenticated with check ((select private.is_admin()));
create policy "thought_categories_admin_update" on public.thought_categories for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "thought_categories_admin_delete" on public.thought_categories for delete to authenticated using ((select private.is_admin()));

create policy "thoughts_public_read" on public.thoughts for select to anon using (published = true);
create policy "thoughts_member_read" on public.thoughts for select to authenticated using (published = true or (select private.is_admin()));
create policy "thoughts_admin_insert" on public.thoughts for insert to authenticated with check ((select private.is_admin()));
create policy "thoughts_admin_update" on public.thoughts for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "thoughts_admin_delete" on public.thoughts for delete to authenticated using ((select private.is_admin()));

create policy "paintings_member_read" on public.paintings for select to authenticated
using ((published = true and (select private.is_active_user())) or (select private.is_admin()));
create policy "paintings_admin_insert" on public.paintings for insert to authenticated with check ((select private.is_admin()));
create policy "paintings_admin_update" on public.paintings for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "paintings_admin_delete" on public.paintings for delete to authenticated using ((select private.is_admin()));

create policy "highlight_categories_member_read" on public.highlight_categories for select to authenticated using ((select private.is_active_user()));
create policy "highlight_categories_admin_insert" on public.highlight_categories for insert to authenticated with check ((select private.is_admin()));
create policy "highlight_categories_admin_update" on public.highlight_categories for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "highlight_categories_admin_delete" on public.highlight_categories for delete to authenticated using ((select private.is_admin()));

create policy "highlights_member_read" on public.highlights for select to authenticated
using ((published = true and (select private.is_active_user())) or (select private.is_admin()));
create policy "highlights_admin_insert" on public.highlights for insert to authenticated with check ((select private.is_admin()));
create policy "highlights_admin_update" on public.highlights for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "highlights_admin_delete" on public.highlights for delete to authenticated using ((select private.is_admin()));

create policy "comments_public_read" on public.comments for select to anon
using (exists (select 1 from public.thoughts t where t.id = thought_id and t.published = true));
create policy "comments_member_read" on public.comments for select to authenticated
using (exists (select 1 from public.thoughts t where t.id = thought_id and t.published = true) or (select private.is_admin()));
create policy "comments_member_insert" on public.comments for insert to authenticated
with check ((select auth.uid()) = user_id and (select private.is_active_user()));
create policy "comments_owner_or_admin_delete" on public.comments for delete to authenticated
using ((select auth.uid()) = user_id or (select private.is_admin()));

create policy "thought_likes_public_read" on public.thought_likes for select to anon, authenticated using (true);
create policy "thought_likes_member_insert" on public.thought_likes for insert to authenticated with check ((select auth.uid()) = user_id and (select private.is_active_user()));
create policy "thought_likes_owner_delete" on public.thought_likes for delete to authenticated using ((select auth.uid()) = user_id);
create policy "painting_likes_member_read" on public.painting_likes for select to authenticated using ((select private.is_active_user()));
create policy "painting_likes_member_insert" on public.painting_likes for insert to authenticated with check ((select auth.uid()) = user_id and (select private.is_active_user()));
create policy "painting_likes_owner_delete" on public.painting_likes for delete to authenticated using ((select auth.uid()) = user_id);
create policy "highlight_likes_member_read" on public.highlight_likes for select to authenticated using ((select private.is_active_user()));
create policy "highlight_likes_member_insert" on public.highlight_likes for insert to authenticated with check ((select auth.uid()) = user_id and (select private.is_active_user()));
create policy "highlight_likes_owner_delete" on public.highlight_likes for delete to authenticated using ((select auth.uid()) = user_id);

create policy "cart_owner_select" on public.cart_items for select to authenticated using (
  (select auth.uid()) = user_id and (select private.is_active_user()) and not (select private.is_admin())
);
create policy "cart_owner_insert" on public.cart_items for insert to authenticated with check (
  (select auth.uid()) = user_id and (select private.is_active_user()) and not (select private.is_admin())
  and exists (select 1 from public.paintings p where p.id = painting_id and p.published and p.is_available and p.price is not null)
);
create policy "cart_owner_delete" on public.cart_items for delete to authenticated using (
  (select auth.uid()) = user_id and (select private.is_active_user()) and not (select private.is_admin())
);

create policy "orders_owner_or_admin_read" on public.orders for select to authenticated using ((select auth.uid()) = user_id or (select private.is_admin()));
create policy "orders_admin_update" on public.orders for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "order_items_owner_or_admin_read" on public.order_items for select to authenticated using (
  exists (select 1 from public.orders o where o.id = order_id and (o.user_id = (select auth.uid()) or (select private.is_admin())))
);
create policy "activity_admin_read" on public.activity_events for select to authenticated using ((select private.is_admin()));

revoke all on all tables in schema public from anon, authenticated;
grant select on public.thought_categories, public.thoughts, public.comments to anon;
grant select on public.user_profiles to authenticated;
grant update (full_name, phone_number) on public.user_profiles to authenticated;
grant select, insert, update, delete on public.thought_categories, public.thoughts, public.paintings,
  public.highlight_categories, public.highlights, public.comments, public.thought_likes,
  public.painting_likes, public.highlight_likes, public.cart_items, public.orders,
  public.order_items to authenticated;
grant select on public.activity_events to authenticated;
grant usage, select on sequence public.activity_events_id_seq to authenticated;

insert into public.thought_categories (name, sort_order)
values ('Studio notes', 10), ('Inspiration', 20), ('Process', 30), ('Exhibitions', 40), ('Personal', 50)
on conflict (name) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('artworks', 'artworks', false, 15728640, array['image/jpeg', 'image/png', 'image/webp']),
  ('highlights', 'highlights', false, 52428800, array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "protected_media_member_read" on storage.objects for select to authenticated
using (bucket_id in ('artworks', 'highlights') and (select private.is_active_user()));
create policy "protected_media_admin_insert" on storage.objects for insert to authenticated
with check (bucket_id in ('artworks', 'highlights') and (select private.is_admin()));
create policy "protected_media_admin_update" on storage.objects for update to authenticated
using (bucket_id in ('artworks', 'highlights') and (select private.is_admin()))
with check (bucket_id in ('artworks', 'highlights') and (select private.is_admin()));
create policy "protected_media_admin_delete" on storage.objects for delete to authenticated
using (bucket_id in ('artworks', 'highlights') and (select private.is_admin()));
