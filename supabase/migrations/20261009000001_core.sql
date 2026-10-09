-- Ядро мультитенантной онлайн-записи.
-- Один проект Supabase, tenant_id во всех зависимых таблицах, составные FK (tenant_id, id).

create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;
create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public;

-- ───────────── Тенанты ─────────────
create table public.tenants (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,40}$'),
  name          text not null,
  status        text not null default 'preview' check (status in ('preview','live','disabled')),
  timezone      text not null default 'Asia/Yekaterinburg',
  currency      text not null default 'RUB',
  slot_step_min int  not null default 30 check (slot_step_min between 5 and 240),
  min_lead_min  int  not null default 60 check (min_lead_min >= 0),
  horizon_days  int  not null default 30 check (horizon_days between 1 and 180),
  finish_within_hours boolean not null default true,
  -- Публичная витрина: тексты, контакты, акцент, фото. Без персональных данных.
  public_config jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create or replace function private.check_timezone()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'unknown timezone %', new.timezone using errcode = '22023';
  end if;
  return new;
end; $$;
create trigger tenants_tz before insert or update of timezone on public.tenants
  for each row execute function private.check_timezone();

create table public.tenant_members (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  role      text not null default 'owner' check (role in ('owner','staff')),
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);

-- ───────────── Ресурсы (мастера / столы) ─────────────
create table public.resources (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  key        text not null,
  name       text not null,
  role_title text,
  bio        text,
  photo_url  text,
  is_active  boolean not null default true,
  sort       int not null default 0,
  unique (tenant_id, id),
  unique (tenant_id, key)
);

-- ───────────── Услуги и варианты (по размеру питомца) ─────────────
create table public.services (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  key         text not null,
  category    text not null,
  name        text not null,
  description text,
  photo_url   text,
  buffer_min  int not null default 0 check (buffer_min between 0 and 240),
  is_active   boolean not null default true,
  sort        int not null default 0,
  unique (tenant_id, id),
  unique (tenant_id, key)
);

create table public.service_variants (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null,
  service_id   uuid not null,
  key          text not null,
  label        text not null,
  hint         text,
  price        int  not null check (price >= 0),
  price_is_from boolean not null default false,
  duration_min int  not null check (duration_min between 5 and 4320),
  is_active    boolean not null default true,
  sort         int not null default 0,
  unique (tenant_id, id),
  unique (tenant_id, service_id, key),
  foreign key (tenant_id, service_id) references public.services(tenant_id, id) on delete cascade
);

create table public.service_resources (
  tenant_id   uuid not null,
  service_id  uuid not null,
  resource_id uuid not null,
  primary key (service_id, resource_id),
  foreign key (tenant_id, service_id)  references public.services(tenant_id, id)  on delete cascade,
  foreign key (tenant_id, resource_id) references public.resources(tenant_id, id) on delete cascade
);

-- ───────────── Расписание ─────────────
-- Рабочие часы задают моменты приёма (когда можно начать услугу).
create table public.working_hours (
  id        uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  weekday   int  not null check (weekday between 1 and 7), -- ISO: 1=Пн … 7=Вс
  opens_at  time not null,
  closes_at time not null check (closes_at > opens_at),
  unique (tenant_id, weekday, opens_at)
);

create table public.schedule_exceptions (
  id        uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  day       date not null,
  is_closed boolean not null default true,
  opens_at  time,
  closes_at time,
  note      text,
  unique (tenant_id, day),
  check (is_closed or (opens_at is not null and closes_at is not null and closes_at > opens_at))
);

-- ───────────── Записи ─────────────
create table public.bookings (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null,
  service_id      uuid not null,
  variant_id      uuid not null,
  resource_id     uuid not null,
  starts_at       timestamptz not null,
  ends_at         timestamptz not null,           -- конец услуги (без буфера)
  status          text not null default 'confirmed'
                  check (status in ('confirmed','arrived','done','cancelled','no_show')),
  -- Историческая цена и длительность фиксируются в момент записи.
  price           int  not null,
  price_is_from   boolean not null default false,
  duration_min    int  not null,
  buffer_min      int  not null default 0,
  service_name    text not null,
  variant_label   text not null,
  customer_name   text not null check (length(customer_name) between 1 and 80),
  customer_phone  text not null check (customer_phone ~ '^\+?[0-9]{10,15}$'),
  pet_name        text check (length(pet_name) <= 60),
  pet_breed       text check (length(pet_breed) <= 80),
  comment         text check (length(comment) <= 500),
  source          text not null default 'client' check (source in ('client','owner')),
  is_demo         boolean not null default false,
  access_token_hash bytea,
  idempotency_key text,
  cancelled_at    timestamptz,
  cancel_reason   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, idempotency_key),
  check (ends_at > starts_at),
  foreign key (tenant_id, service_id)  references public.services(tenant_id, id),
  foreign key (tenant_id, variant_id)  references public.service_variants(tenant_id, id),
  foreign key (tenant_id, resource_id) references public.resources(tenant_id, id)
);
create index bookings_tenant_start on public.bookings (tenant_id, starts_at);
create unique index bookings_token_hash on public.bookings (access_token_hash) where access_token_hash is not null;

-- Единая занятость ресурса: и записи, и блокировки. Пересечения запрещены на уровне БД.
create table public.resource_occupancies (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null,
  resource_id uuid not null,
  period      tstzrange not null check (not isempty(period) and lower_inc(period) and not upper_inc(period)),
  kind        text not null check (kind in ('booking','block')),
  booking_id  uuid,
  note        text,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  foreign key (tenant_id, resource_id) references public.resources(tenant_id, id) on delete cascade,
  foreign key (tenant_id, booking_id)  references public.bookings(tenant_id, id)  on delete cascade,
  check ((kind = 'booking') = (booking_id is not null)),
  constraint occupancy_no_overlap exclude using gist (resource_id with =, period with &&)
);
create unique index occupancy_one_per_booking on public.resource_occupancies (booking_id) where booking_id is not null;
create index occupancy_tenant_period on public.resource_occupancies using gist (tenant_id, period);

-- ───────────── Платежи ─────────────
create table public.payments (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null,
  booking_id uuid,
  amount     int  not null check (amount > 0),
  method     text not null default 'cash' check (method in ('cash','card','transfer')),
  paid_at    timestamptz not null default now(),
  created_by uuid,
  note       text,
  foreign key (tenant_id, booking_id) references public.bookings(tenant_id, id) on delete set null (booking_id)
);
create index payments_tenant_paid on public.payments (tenant_id, paid_at);

-- ───────────── Служебное ─────────────
create table private.secrets (
  name  text primary key,
  value bytea not null
);
insert into private.secrets (name, value) values ('booking_token_key', extensions.gen_random_bytes(32))
  on conflict do nothing;

create table private.rate_counters (
  bucket       text not null,
  window_start timestamptz not null,
  count        int not null default 0,
  primary key (bucket, window_start)
);

-- Атомарный счётчик: true, если лимит не превышен.
create or replace function private.hit_rate_limit(p_bucket text, p_limit int, p_window interval)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / extract(epoch from p_window)) * extract(epoch from p_window));
  v_count int;
begin
  insert into private.rate_counters as rc (bucket, window_start, count)
  values (p_bucket, v_window, 1)
  on conflict (bucket, window_start) do update set count = rc.count + 1
  returning rc.count into v_count;
  return v_count <= p_limit;
end;
$$;

create or replace function private.client_ip()
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(
    nullif(split_part(coalesce(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''), ',', 1), ''),
    current_setting('request.headers', true)::json ->> 'cf-connecting-ip',
    'unknown'
  );
$$;

create or replace function private.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end; $$;

create trigger tenants_touch  before update on public.tenants  for each row execute function private.touch_updated_at();
create trigger bookings_touch before update on public.bookings for each row execute function private.touch_updated_at();

-- Членство владельца проверяется на сервере.
create or replace function private.is_member(p_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.tenant_members m
    where m.tenant_id = p_tenant and m.user_id = (select auth.uid())
  );
$$;
