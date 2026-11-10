-- REVIEW ONLY. Apply to the verified isolated staging namespace, not production.
begin;
do $$
declare src text;
begin
  -- Expected discovery conflicts must not use a retryable serialization failure.
  src:=pg_get_functiondef('public.field_sales_offer_save(uuid,uuid,uuid,integer,jsonb)'::regprocedure);
  if cardinality(string_to_array(src,'errcode=''40001'''))<>5 then
    raise exception 'Reviewed discovery save conflict definitions changed' using errcode='22023';
  end if;
  src:=replace(src,'errcode=''40001''','errcode=''PT409'''); execute src;
  src:=pg_get_functiondef('public.field_sales_offer_quote(uuid,uuid,uuid,integer,text,jsonb)'::regprocedure);
  if cardinality(string_to_array(src,'errcode=''40001'''))<>2 then
    raise exception 'Reviewed discovery quote conflict definitions changed' using errcode='22023';
  end if;
  src:=replace(src,'errcode=''40001''','errcode=''PT409'''); execute src;
end $$;
commit;
