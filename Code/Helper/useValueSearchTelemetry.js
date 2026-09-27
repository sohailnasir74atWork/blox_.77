import {useEffect, useRef} from 'react';
import {trackGrowthEvent} from './growthAnalytics';

// Record the first completed nonempty search for each screen mount, not each
// keystroke. Search text stays on the device. This measures search results,
// not proof that a trade completed or that the user retained the app.
export default function useValueSearchTelemetry(query, resultCount, catalogCount) {
  const measured = useRef(false);
  useEffect(() => {
    if (measured.current || !query.trim() || !catalogCount) return;
    const timer = setTimeout(() => {
      measured.current = true;
      trackGrowthEvent('value_search_completed', {has_results: resultCount > 0 ? 1 : 0});
    }, 800);
    return () => clearTimeout(timer);
  }, [query, resultCount, catalogCount]);
}
