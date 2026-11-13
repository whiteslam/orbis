'use client';

import { useEffect, useState } from 'react';
import { loadSkillTreeAction } from '@/app/career/actions';
import type { CareerProfile } from '@/lib/career/types';
import type { SkillTree } from '@/lib/career/skill-tree';

export type SkillTreeState = { tree: SkillTree | null; profile: CareerProfile | null; ready: boolean };

// One load per page visit, shared by the Skills view and every job sheet that
// shows the tree's proof; an upload or removal replaces it.
let cached: Promise<SkillTreeState | null> | null = null;
const listeners = new Set<(state: SkillTreeState | null) => void>();

function fetchTree(): Promise<SkillTreeState | null> {
  return loadSkillTreeAction()
    .then((result) => (result.success ? result.data : null))
    .catch(() => null);
}

/** Puts a new state in the cache and tells every open view. */
export function setSkillTreeCache(state: SkillTreeState | null) {
  cached = Promise.resolve(state);
  for (const listener of listeners) listener(state);
}

/** Forgets the cached tree, so the next view loads it again. */
export function reloadSkillTree() {
  cached = fetchTree();
  void cached.then((state) => { for (const listener of listeners) listener(state); });
}

/** The owner's skill tree, loaded once and shared. `undefined` while loading, null when it couldn't load. */
export function useSkillTree(): SkillTreeState | null | undefined {
  const [state, setState] = useState<SkillTreeState | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    cached ??= fetchTree();
    void cached.then((value) => { if (live) setState(value); });
    const listener = (value: SkillTreeState | null) => { if (live) setState(value); };
    listeners.add(listener);
    return () => {
      live = false;
      listeners.delete(listener);
    };
  }, []);
  return state;
}
