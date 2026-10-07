// The one answer to "should this user see ads?" for React code.
//
// Pro comes from two places: `localState.isPro` (RevenueCat entitlement) and
// `proGranted` (RTDB-purchase membership, GlobelStats.js). Call sites checked
// one, the other or both, so some screens kept showing ads to paying users.
// The non-React ad managers read the same two flags from MMKV (isProUser()).
import { useGlobalState } from '../GlobelStats';
import { useLocalState } from '../LocalGlobelStats';

export default function useIsAdFree() {
  const { localState } = useLocalState();
  const { proGranted } = useGlobalState();
  return !!(localState?.isPro || proGranted);
}
