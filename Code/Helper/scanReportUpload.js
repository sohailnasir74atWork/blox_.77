/**
 * scanReportUpload.js — Trade Scanner "Send picture" (2026-11-03).
 *
 * Only on the user's tap: the picked picture and a JSON of what the scan
 * read go to the private Supabase storage bucket `scan-reports` under
 * blox/<uuid>.{jpg,json} (supabase/060_scan_reports_bucket.sql: clients may
 * only insert there, nobody but the service role reads). The scanner team
 * downloads them with RunningApps/_scanner_ml/fetch_reports.py --app blox to
 * fix and retrain the scanner. No storage key ships in the app; the upload
 * uses the public publishable key the chat already uses.
 */
import RNFS from 'react-native-fs';
import { safeCompressImage } from './safeCompressImage';
import { uuidv4 } from '../Supabase/uuid';
import { supabase } from '../Supabase/client';

const BUCKET = 'scan-reports';
const FOLDER = 'blox';

const put = async (path, body, contentType) => {
  const { error } = await supabase.storage.from(BUCKET).upload(path, body, { contentType, upsert: false });
  if (error) throw new Error(error.message || 'upload');
};

/** Upload the picture and its scan info. Resolves to the report id; throws on failure. */
export const uploadScanReport = async (uri, meta) => {
  const id = uuidv4();
  const compressed = await safeCompressImage(uri, { returnableOutputType: 'uri' }).catch(() => null);
  const local = compressed?.uri || uri;
  const base64 = await RNFS.readFile(String(local).replace('file://', ''), 'base64');
  await put(`${FOLDER}/${id}.jpg`, Uint8Array.from(global.atob(base64), (c) => c.charCodeAt(0)), 'image/jpeg');
  await put(`${FOLDER}/${id}.json`, JSON.stringify(meta), 'application/json');
  return id;
};
