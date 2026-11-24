-- A project can have its own sample article. It overrides the guideline profile's sample for that
-- project only, so projects that share a client profile can still follow different layouts.
alter table public.projects
  add column if not exists sample_name       text,
  add column if not exists sample_outline    text,
  add column if not exists sample_word_count integer,
  add column if not exists sample_style      jsonb;
