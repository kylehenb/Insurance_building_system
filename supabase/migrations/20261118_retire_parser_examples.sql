-- Order parsing learns through the learning module now (tech spec §24.4):
-- the "Save as learning example" prompt and its table are retired. Its
-- examples came from lodged orders, which were backfilled as order_parse
-- cases. Apply once the code that no longer reads it is deployed.

DROP TABLE IF EXISTS parser_examples;
