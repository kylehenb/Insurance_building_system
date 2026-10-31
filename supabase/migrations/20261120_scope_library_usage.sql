-- How many quotes each scope library item has been used on, for ordering the
-- scope search (quote editor and field app): among good matches, the items
-- used most come first. Server only (service role).
CREATE OR REPLACE FUNCTION public.scope_library_usage(p_tenant_id UUID)
RETURNS TABLE (scope_library_id UUID, keyword TEXT, uses BIGINT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.scope_library_id, l.keyword, count(DISTINCT s.quote_id) AS uses
    FROM scope_items s
    JOIN scope_library l ON l.id = s.scope_library_id
   WHERE s.tenant_id = p_tenant_id
     AND s.scope_library_id IS NOT NULL
   GROUP BY s.scope_library_id, l.keyword;
$$;

REVOKE ALL ON FUNCTION public.scope_library_usage(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.scope_library_usage(UUID) TO service_role;
