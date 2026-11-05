-- Chosen AI model per project, as "provider:model" (e.g. openai:gpt-5). Null means the server default.
alter table public.projects add column model text;
