create index if not exists thoughts_created_by_idx on public.thoughts (created_by);
create index if not exists paintings_created_by_idx on public.paintings (created_by);
create index if not exists highlights_created_by_idx on public.highlights (created_by);
