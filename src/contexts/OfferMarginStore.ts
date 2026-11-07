'use client';

import { useEffect, useRef, useSyncExternalStore } from 'react';

export interface OfferMarginSnapshot {
  projectId: string;
  actorId: string;
  marginPercent: number | null;
}

type Listener = () => void;

let snapshot: OfferMarginSnapshot | null = null;
let activeOwner: symbol | null = null;
const listeners = new Set<Listener>();

function subscribe(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return snapshot;
}

function getServerSnapshot() {
  return null;
}

function notify() {
  listeners.forEach((listener) => listener());
}

function publish(owner: symbol, next: OfferMarginSnapshot) {
  const unchanged =
    snapshot?.projectId === next.projectId &&
    snapshot.actorId === next.actorId &&
    Object.is(snapshot.marginPercent, next.marginPercent);

  activeOwner = owner;
  if (unchanged) return;

  snapshot = Object.freeze(next);
  notify();
}

function clear(owner: symbol) {
  if (activeOwner !== owner) return;

  activeOwner = null;
  if (snapshot === null) return;

  snapshot = null;
  notify();
}

export function useOfferMarginSnapshot() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function usePublishOfferMargin({
  projectId,
  actorId,
  visible,
  marginPercent,
}: {
  projectId: string;
  actorId?: string;
  visible: boolean;
  marginPercent: number | null;
}) {
  const ownerRef = useRef<symbol | null>(null);
  if (ownerRef.current === null) ownerRef.current = Symbol('offer-margin-owner');

  useEffect(() => {
    const owner = ownerRef.current;
    if (!owner) return;

    if (!visible || !projectId.trim() || !actorId?.trim()) {
      clear(owner);
      return;
    }

    publish(owner, {
      projectId,
      actorId,
      marginPercent:
        marginPercent !== null && Number.isFinite(marginPercent)
          ? marginPercent
          : null,
    });
  }, [projectId, actorId, visible, marginPercent]);

  useEffect(() => {
    const owner = ownerRef.current;
    if (!owner) return;
    return () => clear(owner);
  }, []);
}
