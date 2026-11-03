// Which published Trade Scanner a phone should have (2026-11-03, same as the
// Adopt Me app). Pure, no React Native: tested in __tests__/tradeScanner.test.js.
//
// From build 192 the app ships without the scanner (model + page): the user
// downloads it once from the CDN and updates it from the scanner sheet.
// RTDB testing/scanner_page.releases = { all, mods }:
//   { version, minBuild, model: { url, sha256, bytes }, names: { url, sha256, bytes },
//     html: { url, sha256, bytes, gz } }
// Staff (admin / mods) take releases.mods when it is newer than releases.all.
// needsModel: Android runs the slot model; iOS uses the page only.

function usable(r, build, needsModel) {
  return !!(r && r.version && r.html?.url && r.html?.sha256
    && (!needsModel || (r.model?.url && r.model?.sha256 && r.names?.url && r.names?.sha256))
    && build >= (Number(r.minBuild) || 0));
}

export function pickRelease(manifest, { tester, build, needsModel }) {
  const rel = manifest?.releases || {};
  const all = usable(rel.all, build, needsModel) ? rel.all : null;
  const mods = tester && usable(rel.mods, build, needsModel) ? rel.mods : null;
  if (mods && (!all || mods.version > all.version)) return mods;
  return all;
}

// The files a release needs on this phone.
export function releaseFiles(release, needsModel) {
  if (!release) return [];
  return needsModel ? ['model', 'names', 'html'] : ['html'];
}

// Bytes the phone will download: files it already has (same sha256) are
// copied, and the CDN sends the page gzipped.
export function downloadBytes(release, needsModel, have) {
  return releaseFiles(release, needsModel).reduce((sum, key) => {
    const f = release[key];
    if (have?.[key]?.sha256 && String(have[key].sha256).toLowerCase() === String(f.sha256).toLowerCase()) return sum;
    return sum + (Number(f.gz) || Number(f.bytes) || 0);
  }, 0);
}

// installed: the downloaded scanner on this phone (or null); latest: the
// release this phone should have (or null: offline, nothing published).
//   missing     nothing installed, a release to download
//   unavailable nothing installed, nothing to download
//   old         installed, a newer release is out
//   current     installed and the newest
//   installed   installed, newest unknown (offline, nothing published)
export function scannerState(installed, latest) {
  if (!installed) return latest ? 'missing' : 'unavailable';
  if (!latest) return 'installed';
  return latest.version > installed.version ? 'old' : 'current';
}
