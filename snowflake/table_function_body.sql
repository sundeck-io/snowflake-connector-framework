SELECT f1.value::object FROM (
WITH paginated(response, data)
AS (
    SELECT
      object_construct('sql', sql, 'mode', 'submit')::variant,
      cast(null as variant)
    UNION ALL
    SELECT
      athena_external_function(response:mode::text, response:sql::text, response:execution_id::text, response:next::text, max_results_per_page) as tx,
      tx:data
    FROM paginated
    where response:mode::text in ('pending', 'submit', 'first_page') OR response:next::text is not null
)
SELECT
  data
FROM
    paginated
WHERE data is not null) f0,
LATERAL FLATTEN(input => f0.data) f1
