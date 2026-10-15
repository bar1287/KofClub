'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import type { Endpoints } from './api/endpoints';
import { currentOperator } from './telegram';
import type { OperatorPublic } from './types';

export interface OperatorContext {
  /** The operator's slug when the app runs in an operator's bot, else null. */
  slug: string | null;
  /** Its public details once loaded. */
  info: OperatorPublic | null;
}

let cached: Promise<OperatorPublic | null> | null = null;

const noSubscription = () => () => undefined;

/**
 * The operator's slug, known only in the browser: the server render (and
 * hydration) sees none, then the client switches over without a mismatch.
 */
export function useOperatorSlug(): string | null {
  return useSyncExternalStore(noSubscription, currentOperator, () => null);
}

/** The operator world this tab is in (ADR-019), with its public details. */
export function useOperator(ep: Endpoints): OperatorContext {
  const slug = useOperatorSlug();
  const [info, setInfo] = useState<OperatorPublic | null>(null);
  useEffect(() => {
    if (!slug) return;
    let live = true;
    cached ??= ep.operatorPublic(slug).catch(() => null);
    void cached.then((i) => {
      if (live) setInfo(i);
    });
    return () => {
      live = false;
    };
  }, [ep, slug]);
  return { slug, info };
}
