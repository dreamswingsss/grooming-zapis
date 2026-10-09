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
