-- One insurer order can ask for several things at once ("make safe and BAR",
-- "BAR and roof report"). insurer_orders.wo_types holds them all
-- (lib/insurer-orders/work-order-type.ts WORK_TYPES); wo_type (the main one)
-- and is_make_safe are kept in step with it for the readers that only need
-- one, so neither can drift from the list again.

ALTER TABLE insurer_orders ADD COLUMN IF NOT EXISTS wo_types TEXT[] NOT NULL DEFAULT '{}';

-- The main type: BAR first, as the inspection the job is built around
CREATE OR REPLACE FUNCTION public.primary_work_type(types TEXT[]) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT t FROM unnest(types) AS t
  ORDER BY array_position(ARRAY['BAR','make_safe','roof_report','leak_detection','specialist','quote_only'], t) NULLS LAST
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.sync_order_work_types() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Something that still writes only wo_type (an older screen or tool)
  IF TG_OP = 'INSERT' THEN
    IF coalesce(cardinality(NEW.wo_types), 0) = 0 AND NEW.wo_type IS NOT NULL AND NEW.wo_type <> '' THEN
      NEW.wo_types := ARRAY[NEW.wo_type];
    END IF;
  ELSIF NEW.wo_types IS NOT DISTINCT FROM OLD.wo_types AND NEW.wo_type IS DISTINCT FROM OLD.wo_type THEN
    NEW.wo_types := CASE WHEN NEW.wo_type IS NULL OR NEW.wo_type = '' THEN '{}'::TEXT[] ELSE ARRAY[NEW.wo_type] END;
  END IF;
  NEW.wo_types := coalesce(NEW.wo_types, '{}'::TEXT[]);
  NEW.wo_type := public.primary_work_type(NEW.wo_types);
  NEW.is_make_safe := 'make_safe' = ANY(NEW.wo_types);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sync_order_work_types ON insurer_orders;
CREATE TRIGGER trg_sync_order_work_types BEFORE INSERT OR UPDATE ON insurer_orders
  FOR EACH ROW EXECUTE FUNCTION public.sync_order_work_types();

-- Existing orders: the list from wo_type. "Quote Only" was saved as written
-- (the mapping didn't know it); "variation" came from the parser's
-- "Combination" and doesn't say what was asked for, so it's left empty.
UPDATE insurer_orders SET wo_types = CASE
    WHEN wo_type IS NULL OR wo_type = '' OR wo_type = 'variation' THEN '{}'::TEXT[]
    WHEN lower(wo_type) = 'quote only' THEN ARRAY['quote_only']
    ELSE ARRAY[wo_type]
  END
WHERE cardinality(wo_types) = 0;

-- The parser once saved the client's parsing notes (client_email_config.insurer_hint)
-- as the insurer's name when the email didn't name one
UPDATE insurer_orders o SET insurer = c.name
FROM client_email_config e LEFT JOIN clients c ON c.id = e.client_id
WHERE e.tenant_id = o.tenant_id AND e.insurer_hint IS NOT NULL AND o.insurer = e.insurer_hint;
