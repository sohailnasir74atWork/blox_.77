// Does this database have the sticker (`gif`) columns and rpc from
// supabase/050_stickers.sql?
//
// Both message backends select `gif`. If a build reaches users before 050 is
// applied, PostgREST answers 42703 / PGRST204 (unknown column) or PGRST202
// (unknown rpc), and every DM read and send would fail. Instead the backends
// mark the table unsupported the first time that happens and retry without
// `gif`, and the chat inputs hide their sticker button. Like the `origin`
// fallback in privateMessagesBackend, it flips back only on an app restart.

const supported = { private_messages: true, group_messages: true };
const listeners = new Set();

export const stickersSupported = (table) => supported[table] !== false;

export function markStickersUnsupported(table) {
  if (supported[table] === false) return;
  supported[table] = false;
  listeners.forEach((l) => { try { l(table); } catch (_) {} });
}

export const subscribeStickerSupport = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

// 42703: unknown column in a select / returning list. PGRST204: unknown column
// in an insert body. Both name the column in the message.
export const isUnknownGifColumn = (error) =>
  !!error && (error.code === '42703' || error.code === 'PGRST204') &&
  /\bgif\b/.test(String(error.message || ''));

// send_group_sticker is not there (PostgREST PGRST202, Postgres 42883).
export const isMissingStickerRpc = (error) =>
  !!error && (error.code === 'PGRST202' || error.code === '42883');

// What a sticker send throws while 050 is missing. Same text as the server's
// refusal, so every chat's existing NOT_ALLOWED handling shows it and drops it.
export const stickersUnavailableError = () => {
  const error = new Error('STICKER_NOT_ALLOWED');
  error.code = '23514';
  return error;
};

// The column list without `gif`, for a database that doesn't have it yet.
export const withoutGifColumn = (cols) =>
  cols.split(',').map((c) => c.trim()).filter((c) => c !== 'gif').join(', ');

// Runs build(withGif) and, if the database turns out to lack the gif column,
// once more without it. build returns a supabase query.
export async function selectWithGifFallback(table, build) {
  const withGif = stickersSupported(table);
  let res = await build(withGif);
  if (withGif && isUnknownGifColumn(res.error)) {
    markStickersUnsupported(table);
    res = await build(false);
  }
  return res;
}
