/**
 * reportImageUpload.js — screenshots a player attaches to a complaint or
 * suggestion (Code/Reports). Ported from Adopt Me's modEvidenceUpload.js
 * (2026-10-07): pick up to three images, compress them, upload them, hand
 * back the CDN URLs. The uploadImage function stores them under
 * report-images/<uuid>.<ext>, and the /player_feedback rule only accepts URLs
 * under that folder.
 *
 * Since 2026-10-19 the upload goes through the server (Helper/imageUpload.js,
 * kind 'report'); the app holds no storage key. The zone is public-read and
 * paths are bare UUIDs, so a leaked URL says nothing about who sent it.
 * Staff evidence goes through modEvidenceUpload instead.
 */

import { launchImageLibrary } from 'react-native-image-picker';
import { safeCompressImage } from './safeCompressImage';
import { uploadImage, UPLOAD_KIND } from './imageUpload';

export const MAX_REPORT_IMAGES = 3;

/**
 * Open the library; returns local uris, capped so the caller never holds more
 * than MAX_REPORT_IMAGES. [] on cancel; THROWS when the picker itself fails.
 */
export const pickReportImages = async (alreadyPicked = 0) => {
  const remaining = Math.max(0, MAX_REPORT_IMAGES - alreadyPicked);
  if (remaining === 0) return [];
  const res = await launchImageLibrary({
    mediaType: 'photo',
    selectionLimit: remaining,
    maxWidth: 1600,
    maxHeight: 1600,
    quality: 0.9,
  });
  if (res?.didCancel) return [];
  if (res?.errorCode) throw new Error(res.errorMessage || `Photo picker failed (${res.errorCode}).`);
  return (res?.assets || []).map((a) => a?.uri).filter(Boolean).slice(0, remaining);
};

// safeCompressImage resolves to { uri, ... } on every path; unwrap .uri.
const uploadOne = async (uri) => {
  const compressed = await safeCompressImage(uri, { returnableOutputType: 'uri' }).catch(() => null);
  return uploadImage(compressed?.uri || uri, UPLOAD_KIND.report);
};

/** Upload in order; throws on the first failure. `onProgress(done, total)`. */
export const uploadReportImages = async (uris = [], onProgress) => {
  const list = (Array.isArray(uris) ? uris : []).filter(Boolean).slice(0, MAX_REPORT_IMAGES);
  const urls = [];
  for (const uri of list) {
    urls.push(await uploadOne(uri));
    if (typeof onProgress === 'function') onProgress(urls.length, list.length);
  }
  return urls;
};
