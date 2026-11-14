-- Shorts autopilot styles (lib/shorts/autopilot.ts): the autopilot takes turns between
-- the styles chosen here (bedtime stories, funny true stories). `style` stays, as the
-- first of them, for workers that predate this column.
--
-- Additive and safe to run twice.

alter table public.shorts_autopilot
  add column if not exists styles text[];

update public.shorts_autopilot
  set styles = array[style]
  where styles is null;

alter table public.shorts_autopilot
  alter column styles set default array['cozy-tales'],
  alter column styles set not null;

alter table public.shorts_autopilot drop constraint if exists shorts_autopilot_styles_check;
alter table public.shorts_autopilot add constraint shorts_autopilot_styles_check
  check (cardinality(styles) between 1 and 2 and styles <@ array['cozy-tales', 'tall-tale']::text[]);
