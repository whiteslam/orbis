-- More than one YouTube post time a day (Social → Shorts → YouTube → Schedule).
--
-- post_times holds every time, earliest first; post_time stays as the first of
-- them, so anything still reading only post_time keeps working. The app reads
-- post_times when it is there and falls back to post_time when it isn't, so
-- this is additive and safe to run twice.

alter table public.youtube_settings
  add column if not exists post_times time[];

update public.youtube_settings
  set post_times = array[post_time]
  where post_times is null;

alter table public.youtube_settings
  alter column post_times set default array['18:00'::time];

alter table public.youtube_settings
  drop constraint if exists youtube_settings_post_times_check;
alter table public.youtube_settings
  add constraint youtube_settings_post_times_check
  check (post_times is null or cardinality(post_times) between 1 and 6);
