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
