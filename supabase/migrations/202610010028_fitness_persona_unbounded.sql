-- The fitness persona was capped at 3,000 characters. There was no reason for
-- the number beyond caution when the column was first written: this is one row
-- per person, it is theirs, and how much they want to tell Orbis about how to
-- coach them is not something the schema should be deciding.
--
-- The column is `text`, so it already holds anything Postgres can store; only
-- the check constraint stood in the way. Non-empty is kept, because the form
-- requires an answer and a blank persona is a row that means nothing.
--
-- Safe to run more than once.

alter table public.user_fitness_personas
  drop constraint if exists user_fitness_personas_persona_check;

alter table public.user_fitness_personas
  add constraint user_fitness_personas_persona_check
  check (char_length(btrim(persona)) >= 1);
