import { sqlString } from './lib'

/** SQL: создать пользователя Supabase Auth с подтверждённой почтой и привязать к студии. */
export function ownerSql(slug: string, email: string, password: string) {
  return `do $$
declare uid uuid;
begin
  select id into uid from auth.users where email = ${sqlString(email)};
  if uid is null then
    uid := gen_random_uuid();
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                            confirmation_token, recovery_token, email_change_token_new, email_change)
    values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', ${sqlString(email)},
            extensions.crypt(${sqlString(password)}, extensions.gen_salt('bf')), now(),
            '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), uid, uid::text,
            jsonb_build_object('sub', uid::text, 'email', ${sqlString(email)}, 'email_verified', true),
            'email', now(), now(), now());
  end if;
  perform public.admin_add_member(${sqlString(slug)}, uid, 'owner');
end $$;
`
}
