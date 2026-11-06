-- Approved sample article per client profile: its layout outline guides writing and QA,
-- and its styling (fonts, sizes, margins) is used for the .docx export.
alter table public.guideline_profiles
  add column sample_name text,
  add column sample_outline text,
  add column sample_word_count integer,
  add column sample_style jsonb;
