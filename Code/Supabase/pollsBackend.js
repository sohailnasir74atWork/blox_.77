// Polls backend — Supabase-native, replaces the Firestore `polls` collection.
//
// Why this exists: the Firestore version did a client-side read-modify-
// write of the entire `options` array on every vote. Two concurrent
// voters reading the same snapshot both wrote back their incremented
// copy, losing one of the increments — visibly dropping totals from
// ~500 to ~400 when a burst of users voted at once.
//
// Migration target: supabase/015_polls.sql. Per-option counters live on
// the polls row (parallel arrays). All vote mutations go through the
// cast_poll_vote() SECURITY DEFINER RPC, which locks the row, applies
// the transition, and returns the post-update counters.
//
// UI shape exposed mirrors what PollCard.jsx and AdminDashboard.js
// already consume from the Firestore docs:
//   {
//     id, question, imageUrl, active, createdAt (ISO), createdBy,
//     options: [{ text, votes }],     ← rebuilt from the parallel arrays
//     totalVotes,
//     myVote,                         ← option index user previously chose, or null
//   }

import { supabase } from './client';

// -----------------------------------------------------------------
// Row mappers — DB snake_case → UI shape used by PollCard
// -----------------------------------------------------------------
function fromPollRow(row, myVoteIndex = null) {
  if (!row) return null;
  const texts = Array.isArray(row.option_texts) ? row.option_texts : [];
  const counts = Array.isArray(row.option_counts) ? row.option_counts : [];
  const options = texts.map((text, i) => ({
    text,
    votes: Number(counts[i] || 0),
  }));
  return {
    id: row.id,
    question: row.question,
    imageUrl: row.image_url ?? null,
    active: !!row.active,
    createdAt: row.created_at,
    createdBy: row.created_by ?? null,
    options,
    totalVotes: Number(row.total_votes || 0),
    myVote: myVoteIndex,
  };
}

function fromCommentRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    userName: row.user_name ?? 'User',
    userAvatar: row.user_avatar ?? null,
    text: row.text,
    replyTo: row.reply_to ?? null,
    createdAt: row.created_at,
  };
}

// -----------------------------------------------------------------
// Polls — reads
// -----------------------------------------------------------------

// Active polls for the feed header. Caps at `limit` (defaults to the
// admin-enforced max-3-active rule). Includes the caller's own vote so
// PollCard can prefill without a second round-trip.
export async function fetchActivePolls(userId, limit = 3) {
  const { data, error } = await supabase
    .from('polls')
    .select('*')
    .eq('active', true)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.warn('[pollsBackend] fetchActivePolls error:', error.message);
    return [];
  }
  if (!data || data.length === 0) return [];

  const myVotes = await fetchMyVotes(userId, data.map((r) => r.id));
  return data.map((row) => fromPollRow(row, myVotes[row.id] ?? null));
}

// Admin dashboard list (includes inactive). Voters not joined — admin
// view doesn't need myVote.
export async function fetchAllPolls(limit = 10) {
  const { data, error } = await supabase
    .from('polls')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.warn('[pollsBackend] fetchAllPolls error:', error.message);
    return [];
  }
  return (data || []).map((row) => fromPollRow(row, null));
}

// Returns a { [pollId]: optionIndex } map for the caller's votes across
// the supplied poll IDs. Single round-trip; RLS limits results to own.
async function fetchMyVotes(userId, pollIds) {
  if (!userId || !pollIds || pollIds.length === 0) return {};
  const { data, error } = await supabase
    .from('poll_votes')
    .select('poll_id, option_index')
    .eq('user_id', userId)
    .in('poll_id', pollIds);
  if (error) {
    console.warn('[pollsBackend] fetchMyVotes error:', error.message);
    return {};
  }
  const out = {};
  for (const row of data || []) out[row.poll_id] = row.option_index;
  return out;
}

// -----------------------------------------------------------------
// Polls — mutations
// -----------------------------------------------------------------

// Cast (or change, or idempotently re-confirm) a vote. The RPC returns
// the post-update counters so the client doesn't need to refetch.
//
// Returns: { options: [{text, votes}], totalVotes, myVote } or null on error.
export async function castPollVote(pollId, optionIndex) {
  if (!pollId || optionIndex == null || optionIndex < 0) return null;
  const { data, error } = await supabase.rpc('cast_poll_vote', {
    p_poll_id: pollId,
    p_option_index: optionIndex,
  });
  if (error) {
    console.warn('[pollsBackend] castPollVote error:', error.message);
    throw error;
  }
  // RPC returns jsonb { option_counts, total_votes, my_vote }. We don't
  // get option_texts back (the RPC doesn't echo them — they don't change
  // on a vote), so the caller is responsible for keeping the existing
  // text labels and only updating the counts/total.
  if (!data) return null;
  return {
    optionCounts: Array.isArray(data.option_counts) ? data.option_counts.map(Number) : [],
    totalVotes: Number(data.total_votes || 0),
    myVote: data.my_vote ?? optionIndex,
  };
}

// Admin: create a new poll. `optionTexts` is a string[] of option labels.
// option_counts initialised to a matching-length zero array so the
// arrays_aligned CHECK passes.
export async function createPoll({ question, optionTexts, imageUrl = null, createdBy = null }) {
  const cleanTexts = (optionTexts || []).map((s) => String(s || '').trim()).filter(Boolean);
  if (!question || !question.trim()) throw new Error('question required');
  if (cleanTexts.length < 2) throw new Error('at least 2 options required');

  const optionCounts = new Array(cleanTexts.length).fill(0);
  const { data, error } = await supabase
    .from('polls')
    .insert({
      question: question.trim(),
      image_url: imageUrl || null,
      option_texts: cleanTexts,
      option_counts: optionCounts,
      total_votes: 0,
      active: true,
      created_by: createdBy || null,
    })
    .select('*')
    .single();
  if (error) {
    console.warn('[pollsBackend] createPoll error:', error.message);
    throw error;
  }
  return fromPollRow(data, null);
}

export async function deletePoll(pollId) {
  if (!pollId) return;
  const { error } = await supabase.from('polls').delete().eq('id', pollId);
  if (error) {
    console.warn('[pollsBackend] deletePoll error:', error.message);
    throw error;
  }
}

export async function setPollActive(pollId, active) {
  if (!pollId) return;
  const { error } = await supabase
    .from('polls')
    .update({ active: !!active, updated_at: new Date().toISOString() })
    .eq('id', pollId);
  if (error) {
    console.warn('[pollsBackend] setPollActive error:', error.message);
    throw error;
  }
}

// -----------------------------------------------------------------
// Comments
// -----------------------------------------------------------------

// Paginated by created_at asc + id (id breaks ties for stable order).
// `afterCreatedAt` is the ISO timestamp of the last comment shown;
// `afterId` is its id. Pass both for cursor pagination.
export async function fetchPollComments(pollId, { pageSize = 2, afterCreatedAt = null, afterId = null } = {}) {
  if (!pollId) return { items: [], hasMore: false };
  let q = supabase
    .from('poll_comments')
    .select('*')
    .eq('poll_id', pollId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(pageSize);
  if (afterCreatedAt) {
    // Strict-after using OR( created_at > X, AND( created_at = X, id > Y ) )
    // expressed with PostgREST's `or` filter.
    q = q.or(
      `created_at.gt.${afterCreatedAt},and(created_at.eq.${afterCreatedAt},id.gt.${afterId || ''})`
    );
  }
  const { data, error } = await q;
  if (error) {
    console.warn('[pollsBackend] fetchPollComments error:', error.message);
    return { items: [], hasMore: false };
  }
  const items = (data || []).map(fromCommentRow);
  return { items, hasMore: items.length === pageSize };
}

export async function postPollComment({ pollId, userId, userName, userAvatar, text, replyTo = null }) {
  const trimmed = String(text || '').trim();
  if (!pollId || !userId || !trimmed) throw new Error('pollId, userId, text required');
  const { data, error } = await supabase
    .from('poll_comments')
    .insert({
      poll_id: pollId,
      user_id: userId,
      user_name: userName || 'User',
      user_avatar: userAvatar || null,
      text: trimmed,
      reply_to: replyTo || null,
    })
    .select('*')
    .single();
  if (error) {
    console.warn('[pollsBackend] postPollComment error:', error.message);
    throw error;
  }
  return fromCommentRow(data);
}
