-- Arc Mode: one shared "space" per person; Claude can join with the invite code.
create table if not exists public.spaces (
  id uuid primary key default gen_random_uuid(),
  invite_code text not null unique default replace(gen_random_uuid()::text, '-', ''),
  created_at timestamptz not null default now()
);
create table if not exists public.space_members (
  space uuid not null references public.spaces(id) on delete cascade,
  uid uuid not null references auth.users(id) on delete cascade,
  primary key (space, uid)
);
create table if not exists public.docs (
  space uuid not null references public.spaces(id) on delete cascade,
  col text not null,
  id text not null,
  data jsonb not null default '{}'::jsonb,
  deleted boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  primary key (space, col, id)
);
create index if not exists docs_space_updated on public.docs(space, updated_at);

create or replace function public.touch_doc() returns trigger language plpgsql as $$
begin new.updated_at := clock_timestamp(); new.updated_by := auth.uid(); return new; end $$;
drop trigger if exists docs_touch on public.docs;
create trigger docs_touch before insert or update on public.docs for each row execute function public.touch_doc();

create or replace function public.is_member(p_space uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from space_members where space = p_space and uid = auth.uid())
$$;

alter table public.spaces enable row level security;
alter table public.space_members enable row level security;
alter table public.docs enable row level security;

drop policy if exists spaces_read on public.spaces;
create policy spaces_read on public.spaces for select using (public.is_member(id));
drop policy if exists members_read on public.space_members;
create policy members_read on public.space_members for select using (uid = auth.uid() or public.is_member(space));
drop policy if exists docs_all on public.docs;
create policy docs_all on public.docs for all using (public.is_member(space)) with check (public.is_member(space));

create or replace function public.create_space() returns uuid
language plpgsql security definer set search_path = public as $$
declare s uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select space into s from space_members where uid = auth.uid() limit 1;
  if s is not null then return s; end if;
  insert into spaces default values returning id into s;
  insert into space_members(space, uid) values (s, auth.uid());
  return s;
end $$;

create or replace function public.join_space(p_code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare s uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select id into s from spaces where invite_code = p_code;
  if s is null then raise exception 'Code unbekannt'; end if;
  insert into space_members(space, uid) values (s, auth.uid()) on conflict do nothing;
  return s;
end $$;

grant execute on function public.create_space() to authenticated;
grant execute on function public.join_space(text) to authenticated;

-- live updates between phone, PC and Claude
do $$ begin
  alter publication supabase_realtime add table public.docs;
exception when duplicate_object then null; end $$;
