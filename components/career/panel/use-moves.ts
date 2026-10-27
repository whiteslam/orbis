'use client';

import { useCallback, useRef } from 'react';
import { jobDetailAction, moveApplicationAction, ownerMovesAction } from '@/app/career/actions';
import { connectionMessage } from '@/lib/client/safe-action';
import type { ApplicationStatus } from '@/lib/career/types';
import type { ApplicationDetail, CareerHome, OwnerMove, Result } from '@/lib/career/view';

/**
 * Where the board asks what may move and makes the move, and where Offers
 * reads an offer's detail. The panel uses the server actions; a preview or a
 * test can pass fakes.
 */
export type MoveServices = {
  list: (applicationId: string) => Promise<Result<OwnerMove[]>>;
  move: (applicationId: string, to: ApplicationStatus) => Promise<Result<ApplicationDetail>>;
  detail: (jobId: string) => Promise<Result<ApplicationDetail>>;
};

export const SERVER_MOVES: MoveServices = { list: ownerMovesAction, move: moveApplicationAction, detail: jobDetailAction };

/**
 * Never offered on the board or in a card's menu, whatever the server lists:
 * `sending` is Send itself and `opened` is its link route. Both happen only
 * through the application's Send button, never by a drag.
 */
const SEND_ONLY: ReadonlySet<ApplicationStatus> = new Set(['sending', 'opened']);

/** Moves that close an application, or answer an offer: asked once before they're made. */
export const CONFIRM_MOVES: ReadonlySet<ApplicationStatus> = new Set(['accepted', 'declined', 'withdrawn', 'rejected']);

async function safely<T>(call: () => Promise<Result<T>>): Promise<Result<T>> {
  try {
    return await call();
  } catch {
    return { success: false, message: connectionMessage() };
  }
}

/**
 * The owner's allowed moves per application, asked of the server once and
 * remembered until the home reloads (a move changes what's allowed next).
 * Cards ask as the pointer reaches them, so a drag usually starts with the
 * answer already in hand.
 */
export function useMoveCache(services: MoveServices, home: CareerHome | null) {
  const cache = useRef<{ home: CareerHome | null; map: Map<string, Promise<Result<OwnerMove[]>>> }>({ home, map: new Map() });

  const get = useCallback((applicationId: string) => {
    if (cache.current.home !== home) cache.current = { home, map: new Map() };
    let pending = cache.current.map.get(applicationId);
    if (!pending) {
      pending = safely(() => services.list(applicationId)).then((result) => (
        result.success ? { success: true as const, data: result.data.filter((move) => !SEND_ONLY.has(move.to)) } : result
      ));
      cache.current.map.set(applicationId, pending);
      // A failed answer (offline, not ready) is asked again next time.
      void pending.then((result) => {
        if (!result.success) cache.current.map.delete(applicationId);
      });
    }
    return pending;
  }, [home, services]);

  const move = useCallback((applicationId: string, to: ApplicationStatus) => safely(() => services.move(applicationId, to)), [services]);

  return { get, move };
}
