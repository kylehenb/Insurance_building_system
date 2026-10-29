-- Retire the Brain and Teach mode (tech spec §22.4): the learning module
-- (§24, 20261112_learning_module.sql) replaced them and holds their two
-- workflows. Apply once the code that no longer reads these is deployed.

DROP TABLE IF EXISTS playbook_runs;
DROP TABLE IF EXISTS playbooks;
DROP TABLE IF EXISTS brain_entries;
