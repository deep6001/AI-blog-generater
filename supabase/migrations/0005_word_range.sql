-- Upper bound of the word range (excluding references); min_word_count is the lower bound.
alter table public.guideline_profiles
  add column max_word_count integer not null default 3000 check (max_word_count > 0);
