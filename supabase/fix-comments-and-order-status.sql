drop policy if exists "comments_public_read" on public.comments;
drop policy if exists "comments_member_read" on public.comments;
create policy "comments_public_read" on public.comments for select to anon
using (exists (select 1 from public.thoughts t where t.id = thought_id and t.published = true));
create policy "comments_member_read" on public.comments for select to authenticated
using (exists (select 1 from public.thoughts t where t.id = thought_id and t.published = true) or (select private.is_admin()));
revoke select on public.thought_likes from anon;

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
