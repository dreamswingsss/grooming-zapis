-- Сгенерировано scripts/build-setup-sql.ts. Вставьте целиком в Supabase → SQL Editor → Run.
-- Повторный запуск безопасен только на пустой базе; для обновлений используйте tenant:publish.
begin;

-- ═══ 20261009000001_core.sql ═══
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


-- ═══ 20261009000002_booking_rpc.sql ═══
-- Публичные RPC клиента: свободное время, создание / просмотр / перенос / отмена записи.
-- Клиент передаёт только slug, вариант услуги, время и контакты. Цена, длительность и tenant
-- определяются сервером.

-- Окно приёма на конкретный день с учётом исключений.
create or replace function private.day_window(p_tenant uuid, p_day date)
returns table (opens timestamptz, closes timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  with t as (select timezone from public.tenants where id = p_tenant),
  ex as (
    select e.* from public.schedule_exceptions e where e.tenant_id = p_tenant and e.day = p_day
  )
  select ((p_day + x.opens_at)::timestamp at time zone t.timezone),
         ((p_day + x.closes_at)::timestamp at time zone t.timezone)
  from t,
  lateral (
    select ex.opens_at, ex.closes_at from ex where not ex.is_closed
    union all
    select w.opens_at, w.closes_at from public.working_hours w
     where w.tenant_id = p_tenant
       and w.weekday = extract(isodow from p_day)::int
       and not exists (select 1 from ex)
  ) x;
$$;

-- Ресурсы, которые могут выполнить услугу.
create or replace function private.eligible_resources(p_tenant uuid, p_service uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select r.id from public.resources r
  where r.tenant_id = p_tenant and r.is_active
    and (
      exists (select 1 from public.service_resources sr where sr.service_id = p_service and sr.resource_id = r.id)
      or not exists (select 1 from public.service_resources sr where sr.service_id = p_service)
    )
  order by r.sort, r.name;
$$;

-- Допустим ли старт услуги (часы, шаг сетки, горизонт, упреждение). Без проверки занятости.
create or replace function private.is_valid_start(p_tenant uuid, p_duration int, p_start timestamptz)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  t public.tenants;
  v_day date;
  w record;
begin
  select * into t from public.tenants where id = p_tenant;
  if p_start < now() + make_interval(mins => t.min_lead_min) then return false; end if;
  v_day := (p_start at time zone t.timezone)::date;
  if v_day > (now() at time zone t.timezone)::date + t.horizon_days then return false; end if;
  for w in select * from private.day_window(p_tenant, v_day) loop
    if p_start >= w.opens and p_start < w.closes
       and (extract(epoch from p_start - w.opens)::bigint % (t.slot_step_min * 60)) = 0
       and (not t.finish_within_hours or p_start + make_interval(mins => p_duration) <= w.closes) then
      return true;
    end if;
  end loop;
  return false;
end;
$$;

create or replace function private.tenant_by_slug(p_slug text)
returns public.tenants
language plpgsql
stable
security definer
set search_path = ''
as $$
declare t public.tenants;
begin
  select * into t from public.tenants where slug = p_slug and status in ('preview','live');
  if not found then raise exception 'TENANT_NOT_FOUND' using errcode = 'PT404'; end if;
  return t;
end;
$$;

-- Токен доступа к одной записи: HMAC(id) серверным ключом. В БД хранится только sha256(token).
-- Детерминированность позволяет повторно выдать тот же доступ при retry с тем же ключом идемпотентности.
create or replace function private.booking_token(p_booking uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select rtrim(translate(encode(extensions.hmac(convert_to(p_booking::text, 'UTF8'), s.value, 'sha256'), 'base64'), '+/', '-_'), '=')
  from private.secrets s where s.name = 'booking_token_key';
$$;

create or replace function private.token_hash(p_token text)
returns bytea
language sql
immutable
set search_path = ''
as $$ select extensions.digest(convert_to(p_token, 'UTF8'), 'sha256'); $$;

create or replace function private.booking_by_token(p_token text)
returns public.bookings
language plpgsql
stable
security definer
set search_path = ''
as $$
declare b public.bookings;
begin
  if p_token is null or length(p_token) < 20 or length(p_token) > 100 then
    raise exception 'BOOKING_NOT_FOUND' using errcode = 'PT404';
  end if;
  select * into b from public.bookings where access_token_hash = private.token_hash(p_token);
  if not found then raise exception 'BOOKING_NOT_FOUND' using errcode = 'PT404'; end if;
  return b;
end;
$$;

-- ───────────── Свободное время ─────────────
create or replace function public.get_slots(p_slug text, p_variant_id uuid, p_day date)
returns table (starts_at timestamptz, resource_ids uuid[])
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  t public.tenants;
  v public.service_variants;
  s public.services;
  w record;
  v_len interval;
begin
  t := private.tenant_by_slug(p_slug);
  select * into v from public.service_variants where id = p_variant_id and tenant_id = t.id and is_active;
  if not found then raise exception 'SERVICE_NOT_FOUND' using errcode = 'PT404'; end if;
  select * into s from public.services where id = v.service_id and tenant_id = t.id and is_active;
  if not found then raise exception 'SERVICE_NOT_FOUND' using errcode = 'PT404'; end if;
  v_len := make_interval(mins => v.duration_min + s.buffer_min);

  for w in select * from private.day_window(t.id, p_day) loop
    return query
      select g.ts, array_agg(r.rid order by r.ord)
      from generate_series(w.opens, w.closes - interval '1 second', make_interval(mins => t.slot_step_min)) as g(ts)
      cross join lateral (
        select e.rid, row_number() over () as ord
        from private.eligible_resources(t.id, s.id) as e(rid)
      ) r
      where private.is_valid_start(t.id, v.duration_min, g.ts)
        and not exists (
          select 1 from public.resource_occupancies o
          where o.resource_id = r.rid and o.period && tstzrange(g.ts, g.ts + v_len, '[)')
        )
      group by g.ts
      order by g.ts;
  end loop;
end;
$$;

-- Дни, в которые есть хотя бы одно свободное окно (для календаря).
create or replace function public.get_available_days(p_slug text, p_variant_id uuid, p_from date, p_to date)
returns setof date
language plpgsql
stable
security definer
set search_path = ''
as $$
declare d date;
begin
  if p_to < p_from or p_to - p_from > 62 then
    raise exception 'RANGE_TOO_LARGE' using errcode = '22023';
  end if;
  for d in select generate_series(p_from, p_to, interval '1 day')::date loop
    if exists (select 1 from public.get_slots(p_slug, p_variant_id, d)) then
      return next d;
    end if;
  end loop;
end;
$$;

-- ───────────── Создание записи ─────────────
create or replace function private.json_booking(b public.bookings, p_token text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', b.id,
    'token', p_token,
    'status', b.status,
    'starts_at', b.starts_at,
    'ends_at', b.ends_at,
    'service_id', b.service_id,
    'variant_id', b.variant_id,
    'service_name', b.service_name,
    'variant_label', b.variant_label,
    'price', b.price,
    'price_is_from', b.price_is_from,
    'duration_min', b.duration_min,
    'resource', (select jsonb_build_object('id', r.id, 'name', r.name, 'photo_url', r.photo_url)
                 from public.resources r where r.id = b.resource_id),
    'customer_name', b.customer_name,
    'pet_name', b.pet_name,
    'pet_breed', b.pet_breed,
    'comment', b.comment,
    'is_demo', b.is_demo,
    'tenant_slug', (select t.slug from public.tenants t where t.id = b.tenant_id),
    'can_change', b.status = 'confirmed' and b.starts_at > now() + interval '2 hours'
  );
$$;

create or replace function public.create_booking(
  p_slug text,
  p_variant_id uuid,
  p_starts_at timestamptz,
  p_customer_name text,
  p_customer_phone text,
  p_idempotency_key text,
  p_resource_id uuid default null,
  p_pet_name text default null,
  p_pet_breed text default null,
  p_comment text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  t public.tenants;
  v public.service_variants;
  s public.services;
  b public.bookings;
  v_phone text := regexp_replace(coalesce(p_customer_phone, ''), '[^0-9+]', '', 'g');
  v_rid uuid;
  v_token text;
  v_len interval;
begin
  t := private.tenant_by_slug(p_slug);

  if p_idempotency_key is null or length(p_idempotency_key) not between 16 and 64 then
    raise exception 'BAD_IDEMPOTENCY_KEY' using errcode = '22023';
  end if;

  -- Повтор того же запроса: вернуть ту же запись и тот же доступ.
  select * into b from public.bookings where tenant_id = t.id and idempotency_key = p_idempotency_key;
  if found then
    return private.json_booking(b, private.booking_token(b.id));
  end if;

  if not private.hit_rate_limit('book:ip:' || private.client_ip(), 20, interval '10 minutes')
     or not private.hit_rate_limit('book:tenant:' || t.id, 300, interval '1 hour') then
    raise exception 'RATE_LIMITED' using errcode = 'PT429';
  end if;

  if v_phone ~ '^8[0-9]{10}$' then v_phone := '+7' || substr(v_phone, 2); end if;
  if v_phone ~ '^7[0-9]{10}$' then v_phone := '+' || v_phone; end if;
  if v_phone !~ '^\+?[0-9]{10,15}$' then
    raise exception 'BAD_PHONE' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_customer_name, ''))) not between 1 and 80 then
    raise exception 'BAD_NAME' using errcode = '22023';
  end if;

  select * into v from public.service_variants where id = p_variant_id and tenant_id = t.id and is_active;
  if not found then raise exception 'SERVICE_NOT_FOUND' using errcode = 'PT404'; end if;
  select * into s from public.services where id = v.service_id and tenant_id = t.id and is_active;
  if not found then raise exception 'SERVICE_NOT_FOUND' using errcode = 'PT404'; end if;

  if not private.is_valid_start(t.id, v.duration_min, p_starts_at) then
    raise exception 'SLOT_UNAVAILABLE' using errcode = 'PT409';
  end if;

  v_len := make_interval(mins => v.duration_min + s.buffer_min);

  -- Конкретный мастер или любой свободный подходящий.
  for v_rid in
    select e.rid from private.eligible_resources(t.id, s.id) as e(rid)
    where p_resource_id is null or e.rid = p_resource_id
  loop
    begin
      insert into public.bookings (
        tenant_id, service_id, variant_id, resource_id, starts_at, ends_at,
        price, price_is_from, duration_min, buffer_min, service_name, variant_label,
        customer_name, customer_phone, pet_name, pet_breed, comment,
        source, is_demo, idempotency_key
      ) values (
        t.id, s.id, v.id, v_rid, p_starts_at, p_starts_at + make_interval(mins => v.duration_min),
        v.price, v.price_is_from, v.duration_min, s.buffer_min, s.name, v.label,
        btrim(p_customer_name), v_phone, nullif(btrim(p_pet_name), ''), nullif(btrim(p_pet_breed), ''), nullif(btrim(p_comment), ''),
        'client', t.status = 'preview', p_idempotency_key
      ) returning * into b;

      insert into public.resource_occupancies (tenant_id, resource_id, period, kind, booking_id)
      values (t.id, v_rid, tstzrange(p_starts_at, p_starts_at + v_len, '[)'), 'booking', b.id);

      v_token := private.booking_token(b.id);
      update public.bookings set access_token_hash = private.token_hash(v_token) where id = b.id
      returning * into b;
      return private.json_booking(b, v_token);
    exception
      when exclusion_violation then
        null; -- этот мастер занят: пробуем следующего
      when unique_violation then
        -- Параллельный повтор с тем же ключом успел раньше.
        select * into b from public.bookings where tenant_id = t.id and idempotency_key = p_idempotency_key;
        if found then return private.json_booking(b, private.booking_token(b.id)); end if;
        raise;
    end;
  end loop;

  raise exception 'SLOT_TAKEN' using errcode = 'PT409';
end;
$$;

-- ───────────── Запись по токену ─────────────
create or replace function public.get_booking(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare b public.bookings;
begin
  b := private.booking_by_token(p_token);
  return private.json_booking(b, p_token);
end;
$$;

create or replace function public.cancel_booking(p_token text, p_reason text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare b public.bookings;
begin
  b := private.booking_by_token(p_token);
  if b.status = 'cancelled' then return private.json_booking(b, p_token); end if;
  if b.status <> 'confirmed' or b.starts_at <= now() + interval '2 hours' then
    raise exception 'TOO_LATE_TO_CHANGE' using errcode = 'PT409';
  end if;
  delete from public.resource_occupancies where booking_id = b.id;
  update public.bookings
     set status = 'cancelled', cancelled_at = now(), cancel_reason = left(nullif(btrim(p_reason), ''), 300)
   where id = b.id returning * into b;
  return private.json_booking(b, p_token);
end;
$$;

-- Перенос атомарный: при конфликте исходная запись остаётся без изменений.
create or replace function public.reschedule_booking(p_token text, p_starts_at timestamptz, p_resource_id uuid default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  b public.bookings;
  v_rid uuid;
begin
  b := private.booking_by_token(p_token);
  if b.status <> 'confirmed' or b.starts_at <= now() + interval '2 hours' then
    raise exception 'TOO_LATE_TO_CHANGE' using errcode = 'PT409';
  end if;
  if b.starts_at = p_starts_at and (p_resource_id is null or p_resource_id = b.resource_id) then
    return private.json_booking(b, p_token);
  end if;
  if not private.is_valid_start(b.tenant_id, b.duration_min, p_starts_at) then
    raise exception 'SLOT_UNAVAILABLE' using errcode = 'PT409';
  end if;

  for v_rid in
    select e.rid from private.eligible_resources(b.tenant_id, b.service_id) as e(rid)
    where (p_resource_id is null and true) or e.rid = p_resource_id
    order by (e.rid = b.resource_id) desc
  loop
    begin
      update public.resource_occupancies
         set resource_id = v_rid,
             period = tstzrange(p_starts_at, p_starts_at + make_interval(mins => b.duration_min + b.buffer_min), '[)')
       where booking_id = b.id;
      update public.bookings
         set starts_at = p_starts_at,
             ends_at = p_starts_at + make_interval(mins => b.duration_min),
             resource_id = v_rid
       where id = b.id returning * into b;
      return private.json_booking(b, p_token);
    exception when exclusion_violation then
      null;
    end;
  end loop;
  raise exception 'SLOT_TAKEN' using errcode = 'PT409';
end;
$$;


-- ═══ 20261009000003_owner_rpc.sql ═══
-- RPC кабинета владельца. Каждая функция проверяет членство в tenant на сервере.

create or replace function private.require_member(p_tenant uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not private.is_member(p_tenant) then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;
end;
$$;

create or replace function private.owner_booking(p_booking uuid)
returns public.bookings
language plpgsql
stable
security definer
set search_path = ''
as $$
declare b public.bookings;
begin
  select * into b from public.bookings where id = p_booking;
  if not found then raise exception 'BOOKING_NOT_FOUND' using errcode = 'PT404'; end if;
  perform private.require_member(b.tenant_id);
  return b;
end;
$$;

-- Студии текущего пользователя.
create or replace function public.owner_my_tenants()
returns table (id uuid, slug text, name text, status text, timezone text, role text)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id, t.slug, t.name, t.status, t.timezone, m.role
  from public.tenant_members m join public.tenants t on t.id = m.tenant_id
  where m.user_id = (select auth.uid())
  order by t.name;
$$;

-- Записи и блокировки за период (для ленты дня / недели).
create or replace function public.owner_agenda(p_tenant uuid, p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_member(p_tenant);
  if p_to <= p_from or p_to - p_from > interval '62 days' then
    raise exception 'RANGE_TOO_LARGE' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'bookings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id, 'status', b.status, 'starts_at', b.starts_at, 'ends_at', b.ends_at,
        'variant_id', b.variant_id, 'service_name', b.service_name, 'variant_label', b.variant_label,
        'price', b.price, 'price_is_from', b.price_is_from, 'duration_min', b.duration_min,
        'resource_id', b.resource_id, 'customer_name', b.customer_name, 'customer_phone', b.customer_phone,
        'pet_name', b.pet_name, 'pet_breed', b.pet_breed, 'comment', b.comment,
        'source', b.source, 'is_demo', b.is_demo, 'created_at', b.created_at,
        'paid', coalesce((select sum(p.amount) from public.payments p where p.booking_id = b.id), 0)
      ) order by b.starts_at)
      from public.bookings b
      where b.tenant_id = p_tenant and b.starts_at < p_to and b.ends_at > p_from
    ), '[]'::jsonb),
    'blocks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id, 'resource_id', o.resource_id, 'starts_at', lower(o.period), 'ends_at', upper(o.period), 'note', o.note
      ) order by lower(o.period))
      from public.resource_occupancies o
      where o.tenant_id = p_tenant and o.kind = 'block' and o.period && tstzrange(p_from, p_to, '[)')
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.owner_set_status(p_booking uuid, p_status text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare b public.bookings;
begin
  b := private.owner_booking(p_booking);
  if p_status not in ('confirmed','arrived','done','no_show','cancelled') then
    raise exception 'BAD_STATUS' using errcode = '22023';
  end if;
  if b.status = 'cancelled' and p_status <> 'cancelled' then
    raise exception 'BOOKING_CANCELLED' using errcode = 'PT409';
  end if;
  if p_status = 'cancelled' then
    delete from public.resource_occupancies where booking_id = b.id;
    update public.bookings set status = 'cancelled', cancelled_at = coalesce(cancelled_at, now()) where id = b.id;
  else
    update public.bookings set status = p_status where id = b.id;
  end if;
  return jsonb_build_object('id', b.id, 'status', p_status);
end;
$$;

-- Перенос владельцем: без ограничений сетки, но без пересечений. Атомарно.
create or replace function public.owner_reschedule(p_booking uuid, p_starts_at timestamptz, p_resource_id uuid default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare b public.bookings; v_rid uuid;
begin
  b := private.owner_booking(p_booking);
  if b.status not in ('confirmed') then
    raise exception 'BOOKING_NOT_ACTIVE' using errcode = 'PT409';
  end if;
  v_rid := coalesce(p_resource_id, b.resource_id);
  if not exists (select 1 from public.resources r where r.id = v_rid and r.tenant_id = b.tenant_id) then
    raise exception 'RESOURCE_NOT_FOUND' using errcode = 'PT404';
  end if;
  begin
    update public.resource_occupancies
       set resource_id = v_rid,
           period = tstzrange(p_starts_at, p_starts_at + make_interval(mins => b.duration_min + b.buffer_min), '[)')
     where booking_id = b.id;
    update public.bookings
       set starts_at = p_starts_at, ends_at = p_starts_at + make_interval(mins => b.duration_min), resource_id = v_rid
     where id = b.id;
  exception when exclusion_violation then
    raise exception 'SLOT_TAKEN' using errcode = 'PT409';
  end;
  return jsonb_build_object('id', b.id, 'starts_at', p_starts_at, 'resource_id', v_rid);
end;
$$;

-- Запись по звонку: владелец ставит клиента вручную (цена и длительность всё равно из каталога).
create or replace function public.owner_create_booking(
  p_tenant uuid, p_variant_id uuid, p_resource_id uuid, p_starts_at timestamptz,
  p_customer_name text, p_customer_phone text,
  p_pet_name text default null, p_pet_breed text default null, p_comment text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  t public.tenants; v public.service_variants; s public.services; b public.bookings;
  v_phone text := regexp_replace(coalesce(p_customer_phone, ''), '[^0-9+]', '', 'g');
begin
  perform private.require_member(p_tenant);
  select * into t from public.tenants where id = p_tenant;
  select * into v from public.service_variants where id = p_variant_id and tenant_id = p_tenant;
  if not found then raise exception 'SERVICE_NOT_FOUND' using errcode = 'PT404'; end if;
  select * into s from public.services where id = v.service_id and tenant_id = p_tenant;
  if not exists (select 1 from public.resources r where r.id = p_resource_id and r.tenant_id = p_tenant) then
    raise exception 'RESOURCE_NOT_FOUND' using errcode = 'PT404';
  end if;
  if v_phone ~ '^8[0-9]{10}$' then v_phone := '+7' || substr(v_phone, 2); end if;
  if v_phone ~ '^7[0-9]{10}$' then v_phone := '+' || v_phone; end if;
  if v_phone !~ '^\+?[0-9]{10,15}$' then raise exception 'BAD_PHONE' using errcode = '22023'; end if;
  begin
    insert into public.bookings (
      tenant_id, service_id, variant_id, resource_id, starts_at, ends_at,
      price, price_is_from, duration_min, buffer_min, service_name, variant_label,
      customer_name, customer_phone, pet_name, pet_breed, comment, source, is_demo
    ) values (
      p_tenant, s.id, v.id, p_resource_id, p_starts_at, p_starts_at + make_interval(mins => v.duration_min),
      v.price, v.price_is_from, v.duration_min, s.buffer_min, s.name, v.label,
      btrim(p_customer_name), v_phone, nullif(btrim(p_pet_name), ''), nullif(btrim(p_pet_breed), ''), nullif(btrim(p_comment), ''),
      'owner', t.status = 'preview'
    ) returning * into b;
    insert into public.resource_occupancies (tenant_id, resource_id, period, kind, booking_id)
    values (p_tenant, p_resource_id, tstzrange(p_starts_at, p_starts_at + make_interval(mins => v.duration_min + s.buffer_min), '[)'), 'booking', b.id);
  exception when exclusion_violation then
    raise exception 'SLOT_TAKEN' using errcode = 'PT409';
  end;
  return jsonb_build_object('id', b.id);
end;
$$;

-- Блокировка времени мастера (перерыв, выходной). p_resource_id = null — для всех мастеров.
create or replace function public.owner_block(p_tenant uuid, p_resource_id uuid, p_from timestamptz, p_to timestamptz, p_note text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare v_ids uuid[];
begin
  perform private.require_member(p_tenant);
  if p_to <= p_from then raise exception 'BAD_RANGE' using errcode = '22023'; end if;
  begin
    with ins as (
      insert into public.resource_occupancies (tenant_id, resource_id, period, kind, note, created_by)
      select p_tenant, r.id, tstzrange(p_from, p_to, '[)'), 'block', left(nullif(btrim(p_note), ''), 200), (select auth.uid())
      from public.resources r
      where r.tenant_id = p_tenant and r.is_active and (p_resource_id is null or r.id = p_resource_id)
      returning id
    ) select array_agg(id) into v_ids from ins;
  exception when exclusion_violation then
    raise exception 'OVERLAPS_BOOKING' using errcode = 'PT409';
  end;
  if v_ids is null then raise exception 'RESOURCE_NOT_FOUND' using errcode = 'PT404'; end if;
  return jsonb_build_object('ids', to_jsonb(v_ids));
end;
$$;

create or replace function public.owner_unblock(p_occupancy uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare v_tenant uuid;
begin
  select tenant_id into v_tenant from public.resource_occupancies where id = p_occupancy and kind = 'block';
  if not found then raise exception 'BLOCK_NOT_FOUND' using errcode = 'PT404'; end if;
  perform private.require_member(v_tenant);
  delete from public.resource_occupancies where id = p_occupancy;
end;
$$;

create or replace function public.owner_add_payment(p_booking uuid, p_amount int, p_method text default 'cash')
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare b public.bookings; v_id uuid;
begin
  b := private.owner_booking(p_booking);
  if p_amount is null or p_amount <= 0 or p_amount > 10000000 then
    raise exception 'BAD_AMOUNT' using errcode = '22023';
  end if;
  insert into public.payments (tenant_id, booking_id, amount, method, created_by)
  values (b.tenant_id, b.id, p_amount, coalesce(p_method, 'cash'), (select auth.uid()))
  returning id into v_id;
  return jsonb_build_object('id', v_id);
end;
$$;

-- Владелец меняет цены и длительность без разработчика. Старые записи хранят свою цену.
create or replace function public.owner_update_variant(p_variant uuid, p_price int, p_duration_min int, p_is_active boolean)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare v_tenant uuid;
begin
  select tenant_id into v_tenant from public.service_variants where id = p_variant;
  if not found then raise exception 'SERVICE_NOT_FOUND' using errcode = 'PT404'; end if;
  perform private.require_member(v_tenant);
  update public.service_variants
     set price = p_price, duration_min = p_duration_min, is_active = p_is_active
   where id = p_variant;
end;
$$;

-- Выходной или особые часы на дату.
create or replace function public.owner_set_day(p_tenant uuid, p_day date, p_is_closed boolean, p_opens time default null, p_closes time default null, p_note text default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform private.require_member(p_tenant);
  insert into public.schedule_exceptions (tenant_id, day, is_closed, opens_at, closes_at, note)
  values (p_tenant, p_day, p_is_closed, p_opens, p_closes, p_note)
  on conflict (tenant_id, day) do update
    set is_closed = excluded.is_closed, opens_at = excluded.opens_at, closes_at = excluded.closes_at, note = excluded.note;
end;
$$;

create or replace function public.owner_clear_day(p_tenant uuid, p_day date)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform private.require_member(p_tenant);
  delete from public.schedule_exceptions where tenant_id = p_tenant and day = p_day;
end;
$$;

-- Статистика считается в SQL, в часовом поясе студии. Период — [p_from, p_to] по местным датам.
-- visits: клиент пришёл (arrived/done); completed: услуга выполнена (done);
-- paid: фактически полученные платежи; expected: стоимость будущих подтверждённых записей (не выручка).
create or replace function public.owner_stats(p_tenant uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  tz text;
  v_from timestamptz;
  v_to timestamptz;
begin
  perform private.require_member(p_tenant);
  if p_to < p_from or p_to - p_from > 366 then raise exception 'BAD_RANGE' using errcode = '22023'; end if;
  select timezone into tz from public.tenants where id = p_tenant;
  v_from := p_from::timestamp at time zone tz;
  v_to := (p_to + 1)::timestamp at time zone tz;

  return (
    with bk as (
      select * from public.bookings where tenant_id = p_tenant and starts_at >= v_from and starts_at < v_to
    )
    select jsonb_build_object(
      'timezone', tz,
      'from', p_from, 'to', p_to,
      'bookings_total', (select count(*) from bk where status <> 'cancelled'),
      'visits', (select count(*) from bk where status in ('arrived','done')),
      'completed', (select count(*) from bk where status = 'done'),
      'no_show', (select count(*) from bk where status = 'no_show'),
      'cancelled', (select count(*) from bk where status = 'cancelled'),
      'paid_total', (select coalesce(sum(amount), 0) from public.payments
                      where tenant_id = p_tenant and paid_at >= v_from and paid_at < v_to),
      'completed_value', (select coalesce(sum(price), 0) from bk where status = 'done'),
      'expected_value', (select coalesce(sum(price), 0) from bk where status = 'confirmed' and starts_at > now()),
      'by_service', coalesce((
        select jsonb_agg(x order by x.cnt desc) from (
          select service_name as name, count(*) as cnt, coalesce(sum(price) filter (where status = 'done'), 0) as done_value
          from bk where status <> 'cancelled' group by service_name
        ) x), '[]'::jsonb),
      'by_day', coalesce((
        select jsonb_agg(jsonb_build_object('day', d.day, 'bookings', d.cnt) order by d.day) from (
          select (starts_at at time zone tz)::date as day, count(*) as cnt
          from bk where status <> 'cancelled' group by 1
        ) d), '[]'::jsonb)
    )
  );
end;
$$;


-- ═══ 20261009000004_security.sql ═══
-- RLS, строгие GRANT. anon не видит персональные данные, платежи и токены.

alter table public.tenants              enable row level security;
alter table public.tenant_members       enable row level security;
alter table public.resources            enable row level security;
alter table public.services             enable row level security;
alter table public.service_variants     enable row level security;
alter table public.service_resources    enable row level security;
alter table public.working_hours        enable row level security;
alter table public.schedule_exceptions  enable row level security;
alter table public.bookings             enable row level security;
alter table public.resource_occupancies enable row level security;
alter table public.payments             enable row level security;

-- Сначала забираем всё, что Supabase раздаёт по умолчанию.
revoke all on all tables    in schema public  from anon, authenticated;
revoke all on all sequences in schema public  from anon, authenticated;
revoke all on all functions in schema public  from public, anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
revoke all on all tables    in schema private from public, anon, authenticated;
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on functions from public, anon, authenticated;

grant usage on schema public to anon, authenticated;

-- Публичная витрина (без персональных данных).
grant select (id, slug, name, status, timezone, currency, slot_step_min, min_lead_min, horizon_days, public_config)
  on public.tenants to anon, authenticated;
grant select (id, tenant_id, key, name, role_title, bio, photo_url, is_active, sort) on public.resources to anon, authenticated;
grant select on public.services, public.service_variants, public.service_resources, public.working_hours
  to anon, authenticated;
grant select (id, tenant_id, day, is_closed, opens_at, closes_at) on public.schedule_exceptions to anon, authenticated;

create or replace function private.tenant_visible(p_tenant uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.tenants where id = p_tenant and status in ('preview','live'));
$$;

create policy tenants_public on public.tenants for select to anon, authenticated
  using (status in ('preview','live') or private.is_member(id));
create policy resources_public on public.resources for select to anon, authenticated
  using (private.tenant_visible(tenant_id) or private.is_member(tenant_id));
create policy services_public on public.services for select to anon, authenticated
  using (private.tenant_visible(tenant_id) or private.is_member(tenant_id));
create policy variants_public on public.service_variants for select to anon, authenticated
  using (private.tenant_visible(tenant_id) or private.is_member(tenant_id));
create policy service_resources_public on public.service_resources for select to anon, authenticated
  using (private.tenant_visible(tenant_id) or private.is_member(tenant_id));
create policy hours_public on public.working_hours for select to anon, authenticated
  using (private.tenant_visible(tenant_id) or private.is_member(tenant_id));
create policy exceptions_public on public.schedule_exceptions for select to anon, authenticated
  using (private.tenant_visible(tenant_id) or private.is_member(tenant_id));

-- Только участники студии. Колонки токена и ключа идемпотентности не выдаются никому.
grant select (id, tenant_id, service_id, variant_id, resource_id, starts_at, ends_at, status, price, price_is_from,
              duration_min, buffer_min, service_name, variant_label, customer_name, customer_phone, pet_name,
              pet_breed, comment, source, is_demo, cancelled_at, cancel_reason, created_at, updated_at)
  on public.bookings to authenticated;
create policy bookings_members on public.bookings for select to authenticated
  using (private.is_member(tenant_id));

grant select on public.resource_occupancies to authenticated;
create policy occupancies_members on public.resource_occupancies for select to authenticated
  using (private.is_member(tenant_id));

grant select on public.payments to authenticated;
create policy payments_members on public.payments for select to authenticated
  using (private.is_member(tenant_id));

grant select on public.tenant_members to authenticated;
create policy members_self on public.tenant_members for select to authenticated
  using (user_id = (select auth.uid()));

-- RPC
grant execute on function public.get_slots(text, uuid, date)                         to anon, authenticated;
grant execute on function public.get_available_days(text, uuid, date, date)          to anon, authenticated;
grant execute on function public.create_booking(text, uuid, timestamptz, text, text, text, uuid, text, text, text) to anon, authenticated;
grant execute on function public.get_booking(text)                                   to anon, authenticated;
grant execute on function public.cancel_booking(text, text)                          to anon, authenticated;
grant execute on function public.reschedule_booking(text, timestamptz, uuid)         to anon, authenticated;

grant execute on function public.owner_my_tenants()                                  to authenticated;
grant execute on function public.owner_agenda(uuid, timestamptz, timestamptz)        to authenticated;
grant execute on function public.owner_set_status(uuid, text)                        to authenticated;
grant execute on function public.owner_reschedule(uuid, timestamptz, uuid)           to authenticated;
grant execute on function public.owner_create_booking(uuid, uuid, uuid, timestamptz, text, text, text, text, text) to authenticated;
grant execute on function public.owner_block(uuid, uuid, timestamptz, timestamptz, text) to authenticated;
grant execute on function public.owner_unblock(uuid)                                 to authenticated;
grant execute on function public.owner_add_payment(uuid, int, text)                  to authenticated;
grant execute on function public.owner_update_variant(uuid, int, int, boolean)       to authenticated;
grant execute on function public.owner_set_day(uuid, date, boolean, time, time, text) to authenticated;
grant execute on function public.owner_clear_day(uuid, date)                         to authenticated;
grant execute on function public.owner_stats(uuid, date, date)                       to authenticated;

-- service_role (конвейер публикации) работает в обход RLS.
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- Политики RLS вызывают эти две функции от имени роли запроса.
grant usage on schema private to anon, authenticated;
grant execute on function private.is_member(uuid)      to anon, authenticated;
grant execute on function private.tenant_visible(uuid) to anon, authenticated;


-- ═══ 20261009000005_publish.sql ═══
-- Публикация business.json → БД. Вызывается только конвейером с service_role.
-- Повторная публикация: записи, исключения расписания и платежи сохраняются; услуги и мастера,
-- которых больше нет в конфиге, деактивируются (на них ссылаются старые записи), а не удаляются.

create or replace function public.admin_publish_tenant(p jsonb, p_status text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_status text;
  r jsonb;
  s jsonb;
  vv jsonb;
  h jsonb;
  d int;
  v_service uuid;
  i int;
begin
  if p ->> 'slug' is null or p ->> 'name' is null then
    raise exception 'CONFIG_INVALID: slug and name are required' using errcode = '22023';
  end if;

  select id, status into v_tenant, v_status from public.tenants where slug = p ->> 'slug';
  v_status := coalesce(p_status, v_status, 'preview');

  insert into public.tenants as t (slug, name, status, timezone, currency, slot_step_min, min_lead_min, horizon_days, finish_within_hours, public_config)
  values (
    p ->> 'slug', p ->> 'name', v_status,
    coalesce(p ->> 'timezone', 'Asia/Yekaterinburg'),
    coalesce(p ->> 'currency', 'RUB'),
    coalesce((p -> 'booking' ->> 'slotStepMin')::int, 30),
    coalesce((p -> 'booking' ->> 'minLeadMin')::int, 60),
    coalesce((p -> 'booking' ->> 'horizonDays')::int, 30),
    coalesce((p -> 'booking' ->> 'finishWithinHours')::boolean, true),
    coalesce(p -> 'public', '{}'::jsonb)
  )
  on conflict (slug) do update set
    name = excluded.name, status = excluded.status, timezone = excluded.timezone, currency = excluded.currency,
    slot_step_min = excluded.slot_step_min, min_lead_min = excluded.min_lead_min, horizon_days = excluded.horizon_days,
    finish_within_hours = excluded.finish_within_hours, public_config = excluded.public_config
  returning t.id into v_tenant;

  -- Мастера
  update public.resources set is_active = false
   where tenant_id = v_tenant
     and key not in (select x ->> 'key' from jsonb_array_elements(p -> 'resources') x);
  i := 0;
  for r in select * from jsonb_array_elements(p -> 'resources') loop
    i := i + 1;
    insert into public.resources (tenant_id, key, name, role_title, bio, photo_url, is_active, sort)
    values (v_tenant, r ->> 'key', r ->> 'name', r ->> 'roleTitle', r ->> 'bio', r ->> 'photo', true, i)
    on conflict (tenant_id, key) do update set
      name = excluded.name, role_title = excluded.role_title, bio = excluded.bio,
      photo_url = excluded.photo_url, is_active = true, sort = excluded.sort;
  end loop;

  -- Услуги и варианты
  update public.services set is_active = false
   where tenant_id = v_tenant
     and key not in (select x ->> 'key' from jsonb_array_elements(p -> 'services') x);
  i := 0;
  for s in select * from jsonb_array_elements(p -> 'services') loop
    i := i + 1;
    insert into public.services (tenant_id, key, category, name, description, photo_url, buffer_min, is_active, sort)
    values (v_tenant, s ->> 'key', s ->> 'category', s ->> 'name', s ->> 'description', s ->> 'photo',
            coalesce((s ->> 'bufferMin')::int, 0), true, i)
    on conflict (tenant_id, key) do update set
      category = excluded.category, name = excluded.name, description = excluded.description,
      photo_url = excluded.photo_url, buffer_min = excluded.buffer_min, is_active = true, sort = excluded.sort
    returning id into v_service;

    update public.service_variants set is_active = false
     where service_id = v_service
       and key not in (select x ->> 'key' from jsonb_array_elements(s -> 'variants') x);
    d := 0;
    for vv in select * from jsonb_array_elements(s -> 'variants') loop
      d := d + 1;
      insert into public.service_variants (tenant_id, service_id, key, label, hint, price, price_is_from, duration_min, is_active, sort)
      values (v_tenant, v_service, vv ->> 'key', vv ->> 'label', vv ->> 'hint', (vv ->> 'price')::int,
              coalesce((vv ->> 'priceIsFrom')::boolean, false), (vv ->> 'durationMin')::int, true, d)
      on conflict (tenant_id, service_id, key) do update set
        label = excluded.label, hint = excluded.hint, price = excluded.price, price_is_from = excluded.price_is_from,
        duration_min = excluded.duration_min, is_active = true, sort = excluded.sort;
    end loop;

    delete from public.service_resources where service_id = v_service;
    if jsonb_typeof(s -> 'resources') = 'array' then
      insert into public.service_resources (tenant_id, service_id, resource_id)
      select v_tenant, v_service, res.id
      from jsonb_array_elements_text(s -> 'resources') k
      join public.resources res on res.tenant_id = v_tenant and res.key = k;
    end if;
  end loop;

  -- Рабочие часы (исключения, заданные владельцем, не трогаем)
  delete from public.working_hours where tenant_id = v_tenant;
  for h in select * from jsonb_array_elements(p -> 'hours') loop
    for d in select jsonb_array_elements_text(h -> 'days')::int loop
      insert into public.working_hours (tenant_id, weekday, opens_at, closes_at)
      values (v_tenant, d, (h ->> 'opens')::time, (h ->> 'closes')::time);
    end loop;
  end loop;

  return jsonb_build_object('tenant_id', v_tenant, 'slug', p ->> 'slug', 'status', v_status);
end;
$$;

revoke all on function public.admin_publish_tenant(jsonb, text) from public, anon, authenticated;
grant execute on function public.admin_publish_tenant(jsonb, text) to service_role;

-- Владелец студии: привязка существующего пользователя Auth.
create or replace function public.admin_add_member(p_slug text, p_user uuid, p_role text default 'owner')
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  insert into public.tenant_members (tenant_id, user_id, role)
  select id, p_user, p_role from public.tenants where slug = p_slug
  on conflict (tenant_id, user_id) do update set role = excluded.role;
  if not found then raise exception 'TENANT_NOT_FOUND' using errcode = 'PT404'; end if;
end;
$$;
revoke all on function public.admin_add_member(text, uuid, text) from public, anon, authenticated;
grant execute on function public.admin_add_member(text, uuid, text) to service_role;

-- Демо-записи для preview, чтобы кабинет не был пустым. Только для preview-тенантов, помечены is_demo.
create or replace function public.admin_seed_demo(p_slug text, p_count int default 8)
returns int
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  t public.tenants;
  names text[] := array['Анна','Мария','Екатерина','Ольга','Дмитрий','Ирина','Сергей','Юлия','Алексей','Наталья'];
  pets  text[] := array['Бусинка','Тоша','Марс','Луна','Чарли','Ричи','Соня','Бакс','Мия','Граф'];
  breeds text[] := array['Шпиц','Йорк','Мальтипу','Пудель','Ши-тцу','Бишон','Корги','Самоед','Мейн-кун','Британская'];
  v_day date;
  v_slot record;
  v_var record;
  n int := 0;
  k int := 0;
  v_res jsonb;
begin
  select * into t from public.tenants where slug = p_slug;
  if not found or t.status <> 'preview' then
    raise exception 'DEMO_ONLY_FOR_PREVIEW' using errcode = '22023';
  end if;
  for v_day in select generate_series((now() at time zone t.timezone)::date + 1, (now() at time zone t.timezone)::date + 6, interval '1 day')::date loop
    exit when n >= p_count;
    for v_var in
      select sv.id from public.service_variants sv join public.services s on s.id = sv.service_id
      where sv.tenant_id = t.id and sv.is_active and s.is_active order by random() limit 2
    loop
      select * into v_slot from public.get_slots(p_slug, v_var.id, v_day) order by random() limit 1;
      continue when v_slot is null;
      k := k + 1;
      v_res := public.create_booking(p_slug, v_var.id, v_slot.starts_at,
        names[1 + (k % array_length(names, 1))],
        '+7900' || lpad((1000000 + k * 7919 % 8999999)::text, 7, '0'),
        'demo-seed-' || p_slug || '-' || v_day || '-' || k || '-' || substr(md5(random()::text), 1, 8),
        null, pets[1 + (k % array_length(pets, 1))], breeds[1 + (k % array_length(breeds, 1))], null);
      n := n + 1;
      exit when n >= p_count;
    end loop;
  end loop;
  return n;
end;
$$;
revoke all on function public.admin_seed_demo(text, int) from public, anon, authenticated;
grant execute on function public.admin_seed_demo(text, int) to service_role;


-- ═══ Студии ═══
select public.admin_publish_tenant('{"slug":"murr","name":"Котосалон «Мурр»","timezone":"Europe/Moscow","currency":"RUB","booking":{"slotStepMin":60,"minLeadMin":120,"horizonDays":21,"finishWithinHours":true},"hours":[{"days":[2,3,4,5,6],"opens":"11:00","closes":"20:00"}],"resources":[{"key":"vera","name":"Вера","roleTitle":"Фелинолог-грумер"}],"services":[{"key":"wash","category":"cats","name":"Мытьё и сушка","photo":"https://images.unsplash.com/photo-1612804145457-d2fb2efc7795","bufferMin":30,"variants":[{"key":"short","label":"Короткая шерсть","price":2400,"priceIsFrom":false,"durationMin":60},{"key":"long","label":"Длинная шерсть","price":3100,"priceIsFrom":false,"durationMin":120}]},{"key":"lion","category":"cats","name":"Стрижка «под льва»","photo":"https://images.unsplash.com/photo-1531549216498-80e1dc380632","bufferMin":30,"variants":[{"key":"any","label":"Любая кошка","price":3500,"priceIsFrom":false,"durationMin":120}]}],"public":{"tagline":"Только кошки. Тихо, бережно, по записи.","accent":"#A99BF0","logoText":"МУРР","heroImage":"https://images.unsplash.com/photo-1511275539165-cc46b1ee89bf","heroAlt":"Кошка умывается","city":"Москва","address":"ул. Тестовая, 2","addressNote":"Второй демо-тенант для проверки изоляции","phone":"+7 (900) 111-11-11","categories":[{"key":"cats","label":"Кошки"}],"highlights":[],"gallery":[{"src":"https://images.unsplash.com/photo-1496284427489-f59461d8a8e6","alt":"Рыжая кошка на руках"}],"faq":[],"photoCredit":"Фото: Unsplash"}}'::jsonb, 'preview');
select public.admin_seed_demo('murr', 10);
select public.admin_publish_tenant('{"slug":"pompon","name":"Груминг-студия «Помпон»","timezone":"Asia/Yekaterinburg","currency":"RUB","booking":{"slotStepMin":30,"minLeadMin":90,"horizonDays":30,"finishWithinHours":true},"hours":[{"days":[1,2,3,4,5],"opens":"10:00","closes":"21:00"},{"days":[6,7],"opens":"10:00","closes":"19:00"}],"resources":[{"key":"alina","name":"Алина","roleTitle":"Старший грумер","bio":"Породные стрижки шпицев, пуделей и йорков. Спокойно работает с тревожными собаками."},{"key":"polina","name":"Полина","roleTitle":"Грумер","bio":"Гигиена, SPA и экспресс-линька. Любит крупных и лохматых."},{"key":"ksenia","name":"Ксения","roleTitle":"Мастер по кошкам","bio":"Кошки любого характера, бережно и без лишнего стресса."}],"services":[{"key":"complex","category":"dogs","name":"Комплексный груминг","description":"Мытьё профкосметикой, сушка, стрижка по породе или на ваш вкус, когти, уши, глаза.","photo":"https://images.unsplash.com/photo-1719464454959-9cf304ef4774","bufferMin":15,"resources":["alina","polina"],"variants":[{"key":"mini","label":"Мини","hint":"до 5 кг · той, йорк, шпиц","price":2800,"priceIsFrom":false,"durationMin":120},{"key":"medium","label":"Средняя","hint":"5–15 кг · пудель, бишон","price":3800,"priceIsFrom":false,"durationMin":150},{"key":"large","label":"Крупная","hint":"15–30 кг · спаниель, корги","price":5200,"priceIsFrom":false,"durationMin":180},{"key":"giant","label":"Гигант","hint":"от 30 кг · самоед, ретривер","price":6500,"priceIsFrom":true,"durationMin":240}]},{"key":"hygiene","category":"dogs","name":"Гигиенический груминг","description":"Лапы, мордочка, гигиеническая зона, когти и уши. Между полными стрижками.","photo":"https://images.unsplash.com/photo-1733210872526-863e2f16cf39","bufferMin":10,"resources":["alina","polina"],"variants":[{"key":"mini","label":"Мини","hint":"до 5 кг","price":1600,"priceIsFrom":false,"durationMin":60},{"key":"medium","label":"Средняя","hint":"5–15 кг","price":2100,"priceIsFrom":false,"durationMin":75},{"key":"large","label":"Крупная","hint":"от 15 кг","price":2800,"priceIsFrom":false,"durationMin":90}]},{"key":"spa","category":"dogs","name":"SPA-мытьё и экспресс-линька","description":"Глубокое мытьё, маска, вычёсывание подшёрстка — дома шерсти станет заметно меньше.","photo":"https://images.unsplash.com/photo-1727510190155-51abda425a82","bufferMin":15,"resources":["polina"],"variants":[{"key":"mini","label":"Мини","hint":"до 5 кг","price":1500,"priceIsFrom":false,"durationMin":60},{"key":"medium","label":"Средняя","hint":"5–15 кг","price":2200,"priceIsFrom":false,"durationMin":90},{"key":"large","label":"Крупная","hint":"от 15 кг","price":3200,"priceIsFrom":false,"durationMin":120}]},{"key":"trimming","category":"dogs","name":"Тримминг","description":"Для жесткошёрстных: терьеры, шнауцеры, таксы. Выщипывание отмершей шерсти вручную.","photo":"https://images.unsplash.com/photo-1528846104175-4fd300ee59da","bufferMin":15,"resources":["alina"],"variants":[{"key":"mini","label":"Мини","hint":"до 8 кг","price":3200,"priceIsFrom":true,"durationMin":150},{"key":"medium","label":"Средняя","hint":"8–20 кг","price":4200,"priceIsFrom":true,"durationMin":180}]},{"key":"cat-complex","category":"cats","name":"Комплекс для кошек","description":"Мытьё, сушка, вычёсывание, когти, уши. Без седации, в тихом кабинете.","photo":"https://images.unsplash.com/photo-1625279138876-8910c2af9a30","bufferMin":15,"resources":["ksenia","polina"],"variants":[{"key":"short","label":"Короткая шерсть","hint":"британцы, шотландцы","price":2900,"priceIsFrom":false,"durationMin":90},{"key":"long","label":"Длинная шерсть","hint":"мейн-кун, перс","price":3600,"priceIsFrom":false,"durationMin":120}]},{"key":"cat-lion","category":"cats","name":"Стрижка кошки «под льва»","description":"Убирает колтуны и спасает от жары. Голова, лапы и хвост — пушистые.","photo":"https://images.unsplash.com/photo-1578652782379-e71e1d1489e7","bufferMin":15,"resources":["ksenia"],"variants":[{"key":"any","label":"Любая кошка","price":3200,"priceIsFrom":false,"durationMin":90}]},{"key":"claws","category":"extra","name":"Стрижка когтей","description":"Аккуратно, без поранений, с подпиливанием.","photo":"https://images.unsplash.com/photo-1611173622933-91942d394b04","bufferMin":5,"variants":[{"key":"any","label":"Собака или кошка","price":500,"priceIsFrom":false,"durationMin":20}]},{"key":"ears","category":"extra","name":"Чистка ушей и глаз","photo":"https://images.unsplash.com/photo-1597603413826-cd1c06b05222","bufferMin":5,"variants":[{"key":"any","label":"Собака или кошка","price":400,"priceIsFrom":false,"durationMin":15}]},{"key":"teeth","category":"extra","name":"Ультразвуковая чистка зубов","description":"Без наркоза, для спокойных питомцев. Убирает налёт и мягкий камень.","photo":"https://images.unsplash.com/photo-1588943211346-0908a1fb0b01","bufferMin":10,"resources":["alina","ksenia"],"variants":[{"key":"any","label":"Собака или кошка","price":2500,"priceIsFrom":false,"durationMin":45}]}],"public":{"tagline":"Стрижём, моем и бережём нервы — ваши и питомца. Запишитесь за минуту.","description":"Небольшая студия для собак и кошек. Один питомец на одного мастера, без клеток и спешки. Профкосметика под тип шерсти, сушим тёплым компрессором.","accent":"#EDA56B","logoText":"ПОМПОН","heroImage":"https://images.unsplash.com/photo-1727681200723-9513e4e3c394","heroAlt":"Грумер расчёсывает собаку после сушки","city":"Екатеринбург","address":"ул. Примерная, 1","addressNote":"Демо-адрес: здесь будет адрес студии","phone":"+7 (900) 000-00-00","whatsapp":"79000000000","telegram":"@example","categories":[{"key":"dogs","label":"Собаки"},{"key":"cats","label":"Кошки"},{"key":"extra","label":"Доп. услуги"}],"highlights":[{"title":"Один на один","text":"Мастер занят только вашим питомцем, без конвейера."},{"title":"Без седации","text":"Работаем спокойно и делаем паузы, если питомец устал."},{"title":"Профкосметика","text":"Подбираем шампунь и кондиционер под тип шерсти."},{"title":"Фото после","text":"Пришлём фото результата, пока вы едете забирать."}],"gallery":[{"src":"https://images.unsplash.com/photo-1611173622933-91942d394b04","alt":"Шпиц в полотенце после мытья","caption":"После SPA"},{"src":"https://images.unsplash.com/photo-1625277743460-43716b93507a","alt":"Чёрный пудель на прогулке"},{"src":"https://images.unsplash.com/photo-1534361960057-19889db9621e","alt":"Ши-тцу бежит по траве"},{"src":"https://images.unsplash.com/photo-1678153184494-1f6fc14a673d","alt":"Собака в зелёной бандане","caption":"Гигиена"},{"src":"https://images.unsplash.com/photo-1583511655826-05700d52f4d9","alt":"Собака в пижаме на жёлтом фоне"},{"src":"https://images.unsplash.com/photo-1597595735781-6a57fb8e3e3d","alt":"Довольный пёс после груминга"}],"faq":[{"q":"Нужно ли кормить перед визитом?","a":"Лучше покормить за 3–4 часа и выгулять перед приходом — так питомцу будет спокойнее."},{"q":"Можно остаться рядом?","a":"Можно, если питомцу так спокойнее. Иногда без хозяина собаки ведут себя ровнее — подскажем по ситуации."},{"q":"Что если опаздываю?","a":"Напишите нам. Если следующий клиент позже, просто начнём чуть позже."},{"q":"Как отменить запись?","a":"В разделе «Мои записи» не позднее чем за 2 часа. Позже — позвоните."}],"photoCredit":"Фото: Unsplash"}}'::jsonb, 'preview');
select public.admin_seed_demo('pompon', 10);
commit;
