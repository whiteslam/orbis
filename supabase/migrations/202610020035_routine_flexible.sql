-- Orbis: routines that are "usually around" a time rather than at it.
--
-- Leaving the office, dinner, bed: these have a usual time, not an appointment.
-- With one clock for every routine, the brief held a 7 pm "Leave office" to
-- 7 pm sharp, called it unanswered within the hour, and by 8:30 counted it as
-- gone by, while the person was still at their desk on a late day.
--
-- `flexible` marks a routine as approximate. The brief then says "around 7",
-- waits three hours instead of ninety minutes before it stops holding the
-- routine open, and never remarks on running late.
--
-- Safe to run more than once.

alter table public.routines
  add column if not exists flexible boolean not null default false;
