begin;
select plan(4);

select ok(
  not has_table_privilege('anon', 'public.hods', 'SELECT'),
  'anonymous client cannot read HOD mobile numbers'
);
select ok(
  not has_table_privilege('anon', 'public.votes', 'SELECT'),
  'anonymous client cannot read votes'
);
select ok(
  not has_schema_privilege('anon', 'private', 'USAGE'),
  'anonymous client cannot enter the private schema containing audit logs'
);
select ok(
  not has_function_privilege(
    'anon',
    'private.submit_ballot(uuid,text,uuid,uuid,uuid,inet,text)',
    'EXECUTE'
  ),
  'anonymous client cannot directly execute the privileged ballot function'
);

select * from finish();
rollback;

