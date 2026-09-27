// Deadlines cover response bodies too: a connected server can stall mid-JSON.
export const withDeadline = (operation, timeoutMs = 12000, onTimeout) => {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error('Catalog request timed out');
      error.code = 'catalog/timeout';
      reject(error);
      onTimeout?.();
    }, timeoutMs);
  });
  return Promise.race([Promise.resolve().then(operation), timeout])
    .finally(() => clearTimeout(timer));
};

export const usableCatalog = value => {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return parsed && typeof parsed === 'object' && !parsed.error &&
      Object.keys(parsed).length > 0 ? parsed : null;
  } catch {
    return null;
  }
};

export const fetchCatalog = (url, options = {}, timeoutMs = 12000) => {
  const controller = new AbortController();
  return withDeadline(async () => {
    const response = await fetch(url, {...options, signal: controller.signal});
    if (!response.ok) {
      const error = new Error(`Catalog HTTP ${response.status}`);
      error.code = `catalog/http-${response.status}`;
      throw error;
    }
    const payload = usableCatalog(await response.json());
    if (!payload) throw new Error('Empty or invalid catalog');
    return payload;
  }, timeoutMs, () => controller.abort());
};

// Each feed commits as soon as it arrives. Another failed or slow feed cannot
// discard this result. Never replace a usable saved catalog with an empty one.
export const refreshCatalog = async ({load, cached, save, fallback}) => {
  try {
    const value = usableCatalog(await load());
    if (!value) throw new Error('Empty or invalid catalog');
    await save(value);
    return {fresh: true, available: true};
  } catch (error) {
    if (usableCatalog(cached)) return {fresh: false, available: true};
    if (fallback) {
      try {
        const value = usableCatalog(await withDeadline(fallback));
        if (value) {
          await save(value);
          return {fresh: true, available: true};
        }
      } catch {
        // Keep the existing cache and expose an actionable retry state.
      }
    }
    return {fresh: false, available: false};
  }
};
