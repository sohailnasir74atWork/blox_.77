/**
 * newsApi.js — the More ▸ News posts: a heading, a body and the date they were
 * last updated. Admins write them from the Admin Dashboard's News tab; the
 * /news/updates/$id rule in database.rules.json lets only admins write.
 *
 * Old app builds read the same /news/updates list (with polls and a feedback
 * box around it), sorted by `order` ascending and showing `tag` as a chip, so
 * every post also carries order = -createdAt (newest first there too) and an
 * empty tag.
 */

import { ref, get, set, push, remove, serverTimestamp } from '@react-native-firebase/database';

export const NEWS_TITLE_MAX = 120;
export const NEWS_BODY_MAX = 5000;

const PATH = 'news/updates';

// Newest first. The seeded "Welcome" post predates createdAt, so anything
// without one goes after the dated posts, in its old `order`.
export const toNewsList = (raw) =>
  Object.entries(raw || {})
    .filter(([, v]) => v && typeof v === 'object' && (v.title || v.body))
    .map(([id, v]) => ({
      id,
      title: String(v.title || ''),
      body: String(v.body || ''),
      createdAt: typeof v.createdAt === 'number' ? v.createdAt : null,
      updatedAt: typeof v.updatedAt === 'number' ? v.updatedAt : (typeof v.createdAt === 'number' ? v.createdAt : null),
      order: typeof v.order === 'number' ? v.order : 0,
    }))
    .sort((a, b) => {
      if (a.createdAt != null && b.createdAt != null) return b.createdAt - a.createdAt;
      if (a.createdAt != null) return -1;
      if (b.createdAt != null) return 1;
      return a.order - b.order;
    });

export async function fetchNews(db) {
  const snap = await get(ref(db, PATH));
  return toNewsList(snap.val());
}

// Creates a post, or rewrites one in place when `post.id` is set. Editing keeps
// the original createdAt (and so its place in the list) and stamps updatedAt.
export async function saveNews(db, uid, { id, title, body, createdAt }) {
  const target = id ? ref(db, `${PATH}/${id}`) : push(ref(db, PATH));
  const created = typeof createdAt === 'number' ? createdAt : null;
  await set(target, {
    title: title.trim().slice(0, NEWS_TITLE_MAX),
    body: body.trim().slice(0, NEWS_BODY_MAX),
    createdAt: created ?? serverTimestamp(),
    updatedAt: serverTimestamp(),
    order: -(created ?? Date.now()),
    tag: '',
    by: uid,
  });
  return target.key;
}

export async function deleteNews(db, id) {
  await remove(ref(db, `${PATH}/${id}`));
}
