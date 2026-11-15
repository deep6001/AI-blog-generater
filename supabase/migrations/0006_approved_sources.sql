-- Sites or pages a client accepts as references. Research may use any site,
-- but the article's reference list may only use these.
alter table public.projects add column if not exists approved_sources text[] not null default '{}';
