-- REVIEW ONLY. Apply to the same identity/session authority as 007 and 043.
-- Recovery preserves disabled/enrollment state; reactivation remains an explicit managed action.
begin;

create function public.field_sales_reset_credentials(p_actor uuid,p_user uuid,p_pin_salt text,p_pin_hash text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare result jsonb;
begin
  perform 1 from public."Dashboard_Users"
    where "User_ID"=p_actor and "Role"='ADMIN' and not "Is_Disabled" for share;
  if not found then raise exception 'Administrator required' using errcode='42501'; end if;
  if length(coalesce(p_pin_salt,''))<20 or length(coalesce(p_pin_hash,''))<40 then
    raise exception 'Invalid credential hash' using errcode='22023';
  end if;
  perform 1 from public."Dashboard_Users" where "User_ID"=p_user and "Role"='SALES' for update;
  if not found then raise exception 'Sales representative not found' using errcode='P0002'; end if;
  update public."Dashboard_Users" set "Pin_Salt"=p_pin_salt,"Pin_Hash"=p_pin_hash,"Updated_At"=now()
    where "User_ID"=p_user;
  delete from public."Dashboard_Sessions" where "User_ID"=p_user;
  select jsonb_build_object('User_ID',"User_ID",'Username',"Username",'Display_Name',"Display_Name",
    'Email',"Email",'Role',"Role",'Is_Disabled',"Is_Disabled",'Updated_At',"Updated_At")
    into result from public."Dashboard_Users" where "User_ID"=p_user;
  return result;
end $$;

-- A login that verified the previous hash before reset must not insert after reset commits.
create function public.field_sales_create_session(p_user uuid,p_pin_hash text,p_token_hash text,
  p_expires_at timestamptz,p_device text) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  perform 1 from public."Dashboard_Users" where "User_ID"=p_user and "Role"='SALES'
    and not "Is_Disabled" and "Pin_Hash"=p_pin_hash for share;
  if not found then raise exception 'Sales credentials changed or account disabled' using errcode='42501'; end if;
  perform public.field_sales_access(p_user);
  if p_token_hash is null or length(p_token_hash)<40 or p_expires_at is null or p_expires_at<=now()
    or p_expires_at>now()+interval '8 hours' then
    raise exception 'Invalid session details' using errcode='22023';
  end if;
  insert into public."Dashboard_Sessions"("User_ID","Token_Hash","Device","Created_At","Expires_At","Last_Seen_At")
    values(p_user,p_token_hash,p_device,now(),p_expires_at,now());
end $$;

revoke all on function public.field_sales_reset_credentials(uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function public.field_sales_create_session(uuid,text,text,timestamptz,text) from public,anon,authenticated;
grant execute on function public.field_sales_reset_credentials(uuid,uuid,text,text) to service_role;
grant execute on function public.field_sales_create_session(uuid,text,text,timestamptz,text) to service_role;
commit;
