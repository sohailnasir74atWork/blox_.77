/**
 * imageUpload.js — every player image upload goes through here.
 *
 * The app no longer holds a Bunny storage key (until 2026-10-19 it was
 * compiled into ten files). It sends the image to the uploadImage Cloud
 * Function (functions/uploadImage.js) with the user's Firebase ID token; the
 * server checks the token, bans, the image bytes (jpeg/png/webp), the size
 * and an hourly quota, picks the storage path (same folders as before),
 * uploads to the post-gag zone and returns the public
 * https://pull-gag.b-cdn.net/... URL.
 *
 * Callers pass a `kind` (UPLOAD_KIND below, must match KINDS in
 * functions/uploadImage.js); the server decides the folder from it.
 * Staff evidence screenshots stay on modEvidenceUpload (Helper/modSanction.js).
 */
import { getAuth, getIdToken } from '@react-native-firebase/auth';
import RNFS from 'react-native-fs';
import { safeCompressImage } from './safeCompressImage';

const UPLOAD_IMAGE_URL =
  'https://us-central1-fruiteblocks.cloudfunctions.net/uploadImage';

export const UPLOAD_KIND = {
  post: 'post', // feed post images (UploadModal)
  dm: 'dm', // private chat images (PrivateMessageInput)
  avatar: 'avatar', // profile picture (Settings)
  status: 'status', // status feed
  chat: 'chat', // group chat images (GroupMessageInput)
  group: 'group', // group icon (CreateGroupModal, GroupsScreen)
  scammer: 'scammer', // scammer database proof
  poll: 'poll', // poll image (AdminDashboard, staff only)
  report: 'report', // More ▸ Complaints & ideas screenshots
};

// The server takes 3 MB (avatars 1 MB). Most pickers already compress to
// ~1024 px, but a few fall back to the original photo when compression
// fails, so anything over 2 MB, or not a jpeg/png/webp (HEIC, GIF), gets one
// JPEG pass here first.
const RECOMPRESS_OVER_BYTES = 2 * 1024 * 1024;
const base64Length = (bytes) => Math.ceil(bytes / 3) * 4;
const isAcceptedImage = (b64) =>
  b64.startsWith('/9j/') || // jpeg ff d8 ff
  b64.startsWith('iVBORw0KGgo') || // png
  (b64.startsWith('UklGR') && b64.slice(12, 16) === 'RUJQ'); // RIFF....WEBP

const readBase64 = (uri) => RNFS.readFile(uri.replace(/^file:\/\//, ''), 'base64');
const asFileUri = (uri) => (/^[a-z]+:\/\//i.test(uri) ? uri : `file://${uri}`);

/**
 * Upload one local image. Resolves to its public CDN URL; throws an Error
 * whose `code` is the server's error ('unauthenticated', 'banned', 'muted',
 * 'too_large', 'bad_image', 'rate_limited', 'upload_failed', …) or
 * 'network'. The message starts with "Bunny upload failed", which
 * Reports/ReportScreen.jsx matches to show its image error.
 * @param {string} uri  file:// URI or plain path
 * @param {keyof UPLOAD_KIND} kind
 * @returns {Promise<string>}
 */
export async function uploadImage(uri, kind) {
  const fail = (code) => Object.assign(new Error(`Bunny upload failed: ${code}`), { code });

  const user = getAuth().currentUser;
  if (!user) throw fail('unauthenticated');
  if (!uri || typeof uri !== 'string') throw fail('bad_image');

  let data = await readBase64(uri);
  if (!isAcceptedImage(data) || data.length > base64Length(RECOMPRESS_OVER_BYTES)) {
    const smaller = await safeCompressImage(asFileUri(uri), {
      compressionMethod: 'manual', maxWidth: 1600, quality: 0.7, output: 'jpg',
    });
    if (smaller.compressed) data = await readBase64(smaller.uri);
  }

  const body = JSON.stringify({ kind, data });
  const send = async (forceRefresh) => fetch(UPLOAD_IMAGE_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await getIdToken(user, forceRefresh)}`,
      'Content-Type': 'application/json',
    },
    body,
  });
  let res;
  try {
    res = await send(false);
    // A token revoked since it was cached (password change etc.): one fresh try.
    if (res.status === 401) res = await send(true);
  } catch (_) {
    throw fail('network');
  }
  let json = null;
  try { json = await res.json(); } catch (_) {}
  if (!res.ok || typeof json?.url !== 'string') throw fail(json?.error || `http_${res.status}`);
  return json.url;
}
