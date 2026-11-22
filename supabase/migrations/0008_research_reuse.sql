-- Keep the approved-reference results with each research run, so a recent run for the same topic can
-- be reused instead of paying for the same web searches again.
alter table public.research_runs
  add column if not exists approved_sources    text[],
  add column if not exists approved_references jsonb,
  add column if not exists rejected_references jsonb;

create index if not exists research_runs_reuse_idx on public.research_runs (tenant_id, lower(topic), created_at desc);
