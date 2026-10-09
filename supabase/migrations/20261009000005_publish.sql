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
