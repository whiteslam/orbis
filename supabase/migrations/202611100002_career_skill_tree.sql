-- Orbis: Career skill tree.
--
-- career_profiles.skill_tree: the owner's skill tree, uploaded from Career →
-- Skills (the tree's data.js, built on their PC from their own commits). It
-- holds branches, skills with levels, CV lines and the newest proof commits
-- per skill, trimmed in the browser. Validated in code
-- (lib/career/skill-tree.ts); null until one is uploaded. It is the owner's to
-- write and clear, so it is in their insert and update grants. Row-level
-- security on career_profiles already keeps it to its owner, and account
-- deletion and export already cover the row.
--
-- Needs 202610270001_career.sql first. Safe to run more than once.

alter table public.career_profiles
  add column if not exists skill_tree jsonb;

alter table public.career_profiles
  drop constraint if exists career_profiles_skill_tree_check;

alter table public.career_profiles
  add constraint career_profiles_skill_tree_check
  check (skill_tree is null or (jsonb_typeof(skill_tree) = 'object' and octet_length(skill_tree::text) <= 400000));

grant insert (skill_tree) on public.career_profiles to authenticated;
grant update (skill_tree) on public.career_profiles to authenticated;
