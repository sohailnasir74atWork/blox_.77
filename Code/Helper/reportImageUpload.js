/**
 * reportImageUpload.js — screenshots a player attaches to a complaint or
 * suggestion (Code/Reports). Ported from Adopt Me's modEvidenceUpload.js
 * (2026-10-07): pick up to three images, compress them, PUT them to Bunny
 * under report-images/<uuid>.jpg, hand back the CDN URLs. The
 * /player_feedback rule only accepts URLs under that folder.
 *
 * Same client-side Bunny path the status feed, uploads and scammer reports
 * already use (the zone is public-read; paths are bare UUIDs, so a leaked
 * URL says nothing about who sent it). Staff evidence goes through the
 * server function modEvidenceUpload instead; moving player uploads there too
 * is its own piece of work.
 */

import { launchImageLibrary } from 'react-native-image-picker';
import RNFS from 'react-native-fs';
import { safeCompressImage } from './safeCompressImage';
import { uuidv4 } from '../Supabase/uuid';

const BUNNY_STORAGE_HOST = 'storage.bunnycdn.com';
const BUNNY_STORAGE_ZONE = 'post-gag';
const BUNNY_ACCESS_KEY = '1b7e1a85-dff7-4a98-ba701fc7f9b9-6542-46e2';
const BUNNY_CDN_BASE = 'https://pull-gag.b-cdn.net';
const FOLDER = 'report-images';

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
  const local = compressed?.uri || uri;
  const remotePath = `${FOLDER}/${uuidv4()}.jpg`;
  const base64 = await RNFS.readFile(String(local).replace('file://', ''), 'base64');
  const binary = Uint8Array.from(global.atob(base64), (c) => c.charCodeAt(0));
  const res = await fetch(`https://${BUNNY_STORAGE_HOST}/${BUNNY_STORAGE_ZONE}/${remotePath}`, {
    method: 'PUT',
    headers: { AccessKey: BUNNY_ACCESS_KEY, 'Content-Type': 'application/octet-stream' },
    body: binary,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Bunny upload failed ${res.status}: ${txt.slice(0, 120)}`);
  }
  return `${BUNNY_CDN_BASE}/${remotePath}`;
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
