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
