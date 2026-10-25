/**
 * useFruitCards — one hook for the Fruit Cards screens: server state (wallet,
 * sets, odds), the catalogue, the player's collection and the live values.
 * Refreshes when a screen gains focus (cached in cardsApi, so cheap).
 *
 * A screen starts from whatever cardsApi already holds (state, catalogue,
 * collection), so it paints complete on its first frame instead of "0 of 0"
 * and an empty strip that jump into place a moment later.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useGlobalState } from '../GlobelStats';
import { useLocalState } from '../LocalGlobelStats';
import { buildValueIndex } from './cardMath';
import { loadArtManifest } from './cardArt';
import {
  getCardsState, getCatalog, getCollection, peekCardsState, peekCatalog, peekCollection, setCardsUser,
} from './cardsApi';

// One value index per values list, shared by every card screen (it walks
// every item in the values data, and each screen used to rebuild it on mount).
let valueIndexFor = null;
let valueIndex = null;
const sharedValueIndex = (rows) => {
  if (rows !== valueIndexFor || !valueIndex) {
    valueIndexFor = rows;
    valueIndex = buildValueIndex(rows);
  }
  return valueIndex;
};

export default function useFruitCards({ withCollection = true } = {}) {
  const { user } = useGlobalState();
  const { localState } = useLocalState();
  // Dev builds can preview the screens signed out (the local mock serves them).
  const uid = user?.id || (__DEV__ ? 'dev-preview' : null);
  setCardsUser(uid);

  const [state, setState] = useState(peekCardsState);
  const [catalog, setCatalog] = useState(() => peekCatalog(peekCardsState()?.catalogVersion) || []);
  const [collection, setCollection] = useState(() => (withCollection ? peekCollection() : null));
  const [loading, setLoading] = useState(!state);
  const [error, setError] = useState(null);
  const alive = useRef(true);

  const values = useMemo(() => sharedValueIndex(localState?.data), [localState?.data]);
  const byKey = useMemo(() => new Map(catalog.map((c) => [c.key, c])), [catalog]);

  const load = useCallback(async (force = false) => {
    if (!uid) {
      setLoading(false);
      return;
    }
    alive.current = true;
    setError(null);
    try {
      loadArtManifest();
      const st = await getCardsState({ force });
      if (!alive.current) return;
      setState(st);
      const [cat, col] = await Promise.all([
        getCatalog(st.catalogVersion),
        withCollection ? getCollection(null, { force }) : Promise.resolve(null),
      ]);
      if (!alive.current) return;
      setCatalog(cat);
      if (withCollection) setCollection(col);
    } catch (e) {
      if (alive.current) setError(e);
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [uid, withCollection]);

  useFocusEffect(useCallback(() => {
    load(false);
    return () => { alive.current = false; };
  }, [load]));

  return {
    uid,
    state,
    wallet: state?.wallet || null,
    sets: state?.sets || [],
    catalog,
    byKey,
    collection,
    owned: collection?.cards || {},
    values,
    loading,
    error,
    reload: () => load(true),
    setState,
    setCollection,
  };
}
