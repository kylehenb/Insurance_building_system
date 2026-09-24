-- report_versions was a write-only autosave snapshot table (full report copy on every
-- 1.5s-debounced field save, uncapped). Nothing ever read from it — no history UI, no
-- restore/diff feature. It diverged from the spec's actual report-versioning design
-- (reports.parent_report_id/version/is_locked, same clone pattern as quotes), and its
-- unbounded growth was a real disk-usage risk. Dropping it entirely; the autosave hook
-- no longer writes to it (see components/reports/useReportAutosave.ts).
DROP TABLE IF EXISTS report_versions;
