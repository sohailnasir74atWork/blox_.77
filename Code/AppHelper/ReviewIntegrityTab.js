// Admin Dashboard → "Reviews" tab (2026-09).
//
// Moderator view of the review-integrity system (functions/reviewIntegrity.js):
//   Held    — traders kept off Top Rated (scam reports ≥10%, or a manual hold)
//   Watch   — traders with scam reports ≥4%, still ranked; a moderator decides
//   Lookup  — any trader by display name
// Tapping a trader shows their verified numbers and every review that does
// not count or reports a scam, with the reason, so a moderator can delete a
// review or hold/release the trader.
//
// Reads: leaderboard_cache/holds (1 doc), review_verified_summary/{uid},
// review_scores (only excluded + scam rows) and the matching reviews docs.
// Names come from Supabase user_identity in one batch.
// A hold is applied by the nightly Top Rated rebuild (00:00 UTC).

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  ScrollView,
  Image,
  TextInput,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import {
  getFirestore,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  collection,
  query as fsQuery,
  where,
  serverTimestamp,
} from '@react-native-firebase/firestore';
import {
  getDatabase,
  ref,
  get,
  query as dbQuery,
  orderByChild,
  startAt,
  endAt,
  limitToFirst,
} from '@react-native-firebase/database';
import { getIdentityBatch } from '../Supabase/userBackend';

const DEFAULT_AVATAR = 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png';

// Mirrors functions/reviewSignals.js HARD / SOFT flags.
const FLAG_LABELS = {
  self: 'Self-review',
  idMismatch: 'Forged',
  invalidRating: 'Bad rating',
  reviewerMissing: 'Deleted account',
  sameDeviceAsReviewee: "Trader's own phone",
  duplicateDevice: '2nd account, same phone',
  newAccount: 'New account',
  quickSwap: 'Swapped reviews',
  burst: 'Review burst',
  noChat: 'No chat',
};

const toMillis = (v) => (v && typeof v.toMillis === 'function' ? v.toMillis() : typeof v === 'number' ? v : 0);
const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : '0%');
const dateOf = (ms) => (ms ? new Date(ms).toLocaleDateString() : '');

const Chip = ({ label, color }) => (
  <View style={{ backgroundColor: color + '22', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, marginRight: 4, marginTop: 4 }}>
    <Text style={{ color, fontSize: 11, fontWeight: '600' }}>{label}</Text>
  </View>
);

const TraderRow = ({ who, subtitle, c, onPress }) => (
  <TouchableOpacity
    onPress={onPress}
    style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: c.card, borderRadius: 12, padding: 12, marginBottom: 8 }}
  >
    <Image resizeMethod="resize" source={{ uri: who.avatar }} style={{ width: 40, height: 40, borderRadius: 20, marginRight: 12 }} />
    <View style={{ flex: 1 }}>
      <Text style={{ color: c.text, fontWeight: '600', fontSize: 15 }} numberOfLines={1}>{who.displayName}</Text>
      {!!subtitle && <Text style={{ color: c.sub, fontSize: 12, marginTop: 2 }}>{subtitle}</Text>}
    </View>
    <Ionicons name="chevron-forward" size={18} color={c.sub} />
  </TouchableOpacity>
);

const ReviewIntegrityTab = ({ isDark, currentUser }) => {
  const c = useMemo(() => ({
    bg: isDark ? '#000' : '#F2F2F7',
    card: isDark ? '#1C1C1E' : '#fff',
    text: isDark ? '#fff' : '#000',
    sub: isDark ? '#8E8E93' : '#6B7280',
    border: isDark ? '#333' : '#E5E5EA',
  }), [isDark]);

  const [section, setSection] = useState('held'); // 'held' | 'watch' | 'lookup'
  const [holds, setHolds] = useState({ users: [], watch: [], lastUpdated: 0 });
  const [identities, setIdentities] = useState(new Map());
  const [loading, setLoading] = useState(false);

  const [lookupText, setLookupText] = useState('');
  const [lookupResults, setLookupResults] = useState([]);
  const [lookupLoading, setLookupLoading] = useState(false);

  const [trader, setTrader] = useState(null); // { userId, displayName, avatar }
  const [summary, setSummary] = useState(null);
  const [rows, setRows] = useState([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const loadHolds = useCallback(async () => {
    setLoading(true);
    try {
      const snap = await getDoc(doc(getFirestore(), 'leaderboard_cache', 'holds'));
      const data = snap.exists() ? snap.data() : {};
      const next = {
        users: data.users || [],
        watch: data.watch || [],
        lastUpdated: toMillis(data.lastUpdated),
      };
      setHolds(next);
      const ids = await getIdentityBatch([...next.users, ...next.watch].map((u) => u.userId));
      setIdentities(ids);
    } catch (e) {
      Alert.alert('Error', `Could not load held traders: ${e?.message || e}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadHolds(); }, [loadHolds]);

  const identityOf = useCallback((uid) => {
    const i = identities.get(uid);
    return { displayName: i?.displayName || 'Unknown', avatar: i?.avatar || DEFAULT_AVATAR };
  }, [identities]);

  const openTrader = useCallback(async (userId, known) => {
    const who = known || identityOf(userId);
    setTrader({ userId, ...who });
    setSummary(null);
    setRows([]);
    setDetailLoading(true);
    try {
      const fs = getFirestore();
      const scores = collection(fs, 'review_scores');
      const [sumSnap, excludedSnap, scamSnap] = await Promise.all([
        getDoc(doc(fs, 'review_verified_summary', userId)),
        getDocs(fsQuery(scores, where('toUserId', '==', userId), where('counted', '==', false))),
        getDocs(fsQuery(scores, where('toUserId', '==', userId), where('scamReport', '==', true))),
      ]);
      setSummary(sumSnap.exists() ? sumSnap.data() : {});
      const scoreDocs = [...excludedSnap.docs, ...scamSnap.docs];
      const reviewSnaps = await Promise.all(scoreDocs.map((d) => getDoc(doc(fs, 'reviews', d.id))));
      const reviewerIds = reviewSnaps.map((s, i) => (s.exists() ? s.data().fromUserId : scoreDocs[i].data().fromUserId));
      const reviewers = await getIdentityBatch(reviewerIds);
      const list = scoreDocs.map((d, i) => {
        const score = d.data();
        const review = reviewSnaps[i].exists() ? reviewSnaps[i].data() : null;
        const reviewer = reviewers.get(score.fromUserId);
        return {
          id: d.id,
          score,
          review,
          reviewerName: reviewer?.displayName || review?.userName || 'Deleted user',
          createdAtMs: toMillis(score.reviewCreatedAt),
        };
      });
      list.sort((a, b) => b.createdAtMs - a.createdAtMs);
      setRows(list);
    } catch (e) {
      Alert.alert('Error', `Could not load reviews: ${e?.message || e}`);
    } finally {
      setDetailLoading(false);
    }
  }, [identityOf]);

  const runLookup = useCallback(async () => {
    const q = lookupText.trim();
    if (q.length < 2) return;
    setLookupLoading(true);
    try {
      const snap = await get(dbQuery(ref(getDatabase(), 'users'), orderByChild('displayName'),
        startAt(q), endAt(q + ''), limitToFirst(10)));
      const found = [];
      snap.forEach((child) => {
        const u = child.val() || {};
        found.push({ userId: child.key, displayName: u.displayName || 'Unknown', avatar: u.avatar || DEFAULT_AVATAR });
        return undefined;
      });
      setLookupResults(found);
    } catch (e) {
      Alert.alert('Error', `Search failed: ${e?.message || e}`);
    } finally {
      setLookupLoading(false);
    }
  }, [lookupText]);

  // Same flow as the Search DB tab: delete the review, then refresh the
  // client-side display summary. The verified summary updates itself
  // (scoreReviewOnWrite handles the delete).
  const deleteReview = useCallback((row) => {
    Alert.alert(
      'Delete review',
      `Delete this ${row.score.rating}★ review by ${row.reviewerName}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            try {
              const fs = getFirestore();
              await deleteDoc(doc(fs, 'reviews', row.id));
              const summaryRef = doc(fs, 'user_ratings_summary', trader.userId);
              const s = await getDoc(summaryRef);
              if (s.exists()) {
                const oldCount = s.data()?.count || 0;
                const oldAvg = s.data()?.averageRating || 0;
                const rating = Number(row.score.rating) || 0;
                if (oldCount <= 1) {
                  await setDoc(summaryRef, { averageRating: 0, count: 0 }, { merge: true });
                } else {
                  const newCount = oldCount - 1;
                  await setDoc(summaryRef, {
                    averageRating: parseFloat((((oldAvg * oldCount) - rating) / newCount).toFixed(2)),
                    count: newCount,
                  }, { merge: true });
                }
              }
              setRows((prev) => prev.filter((r) => r.id !== row.id));
            } catch (e) {
              Alert.alert('Error', `Could not delete: ${e?.message || e}`);
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  }, [trader]);

  const toggleHold = useCallback(() => {
    const holding = !(summary?.leaderboardHold === true);
    Alert.alert(
      holding ? 'Hold from Top Rated' : 'Release hold',
      holding
        ? `${trader.displayName} will be removed from Top Rated at the next rebuild (00:00 UTC).`
        : `${trader.displayName} can rank again from the next rebuild (00:00 UTC), unless their scam reports keep them held.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: holding ? 'Hold' : 'Release',
          style: holding ? 'destructive' : 'default',
          onPress: async () => {
            setBusy(true);
            try {
              const patch = {
                leaderboardHold: holding,
                holdBy: currentUser?.id || null,
                holdByName: currentUser?.displayName || currentUser?.displayname || null,
                holdAt: serverTimestamp(),
              };
              await setDoc(doc(getFirestore(), 'review_verified_summary', trader.userId), patch, { merge: true });
              setSummary((s) => ({ ...(s || {}), leaderboardHold: holding }));
            } catch (e) {
              Alert.alert('Error', `Could not update hold: ${e?.message || e}`);
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  }, [summary, trader, currentUser]);

  // ── Trader detail ──
  if (trader) {
    const s = summary || {};
    const held = s.leaderboardHold === true;
    return (
      <View style={{ flex: 1, backgroundColor: c.bg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', padding: 12 }}>
          <TouchableOpacity onPress={() => setTrader(null)} style={{ paddingRight: 12 }}>
            <Ionicons name="arrow-back" size={22} color="#007AFF" />
          </TouchableOpacity>
          <Image resizeMethod="resize" source={{ uri: trader.avatar }} style={{ width: 36, height: 36, borderRadius: 18, marginRight: 10 }} />
          <Text style={{ color: c.text, fontWeight: '700', fontSize: 17, flex: 1 }} numberOfLines={1}>{trader.displayName}</Text>
        </View>

        {detailLoading ? (
          <ActivityIndicator size="large" color="#007AFF" style={{ marginTop: 40 }} />
        ) : (
          <FlatList
            data={rows}
            keyExtractor={(r) => r.id}
            contentContainerStyle={{ padding: 12, paddingTop: 0, paddingBottom: 40 }}
            ListHeaderComponent={
              <View style={{ backgroundColor: c.card, borderRadius: 12, padding: 12, marginBottom: 12 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  {[
                    ['Verified', s.count || 0],
                    ['Not counted', s.excludedCount || 0],
                    ['Flagged', s.flaggedCount || 0],
                    ['Scam reports', `${s.scamReports || 0} (${pct(s.scamReports || 0, s.count || 0)})`],
                  ].map(([label, value]) => (
                    <View key={label} style={{ alignItems: 'center', flex: 1 }}>
                      <Text style={{ color: c.text, fontWeight: '700', fontSize: 15 }}>{value}</Text>
                      <Text style={{ color: c.sub, fontSize: 11, marginTop: 2 }}>{label}</Text>
                    </View>
                  ))}
                </View>
                <Text style={{ color: c.sub, fontSize: 12, marginTop: 10 }}>
                  Average {Number(s.averageRating || 0).toFixed(2)}★ from verified reviews.
                  {held ? ` Held from Top Rated${s.holdByName ? ` by ${s.holdByName}` : ''}.` : ''}
                </Text>
                <TouchableOpacity
                  disabled={busy}
                  onPress={toggleHold}
                  style={{ marginTop: 10, borderRadius: 8, paddingVertical: 10, alignItems: 'center',
                    backgroundColor: held ? '#34C759' : '#FF3B30', opacity: busy ? 0.6 : 1 }}
                >
                  <Text style={{ color: '#fff', fontWeight: '700' }}>{held ? 'Release hold' : 'Hold from Top Rated'}</Text>
                </TouchableOpacity>
                <Text style={{ color: c.sub, fontSize: 12, marginTop: 12 }}>
                  Reviews below don't count or report a scam. Soft flags (new account, swapped reviews…) still count.
                </Text>
              </View>
            }
            ListEmptyComponent={
              <Text style={{ color: c.sub, textAlign: 'center', marginTop: 24 }}>No excluded reviews or scam reports.</Text>
            }
            renderItem={({ item: r }) => (
              <View style={{ backgroundColor: c.card, borderRadius: 12, padding: 12, marginBottom: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Text style={{ color: c.text, fontWeight: '600', flex: 1 }} numberOfLines={1}>{r.reviewerName}</Text>
                  <Text style={{ color: '#FF9500', fontWeight: '700' }}>{'★'.repeat(Math.max(0, Math.min(5, Number(r.score.rating) || 0)))}</Text>
                </View>
                {!!r.review?.review && <Text style={{ color: c.text, marginTop: 6 }}>{r.review.review}</Text>}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 4 }}>
                  {r.score.scamReport && <Chip label="Scam report" color="#FF9500" />}
                  {(r.score.hard || []).map((f) => <Chip key={f} label={FLAG_LABELS[f] || f} color="#FF3B30" />)}
                  {(r.score.soft || []).map((f) => <Chip key={f} label={FLAG_LABELS[f] || f} color="#8E8E93" />)}
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
                  <Text style={{ color: c.sub, fontSize: 12, flex: 1 }}>{dateOf(r.createdAtMs)}</Text>
                  {r.review && (
                    <TouchableOpacity disabled={busy} onPress={() => deleteReview(r)}>
                      <Text style={{ color: '#FF3B30', fontWeight: '600', fontSize: 13 }}>Delete review</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            )}
          />
        )}
      </View>
    );
  }

  // ── Lists ──
  const listData = section === 'held' ? holds.users : holds.watch;
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }}
        contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 8 }}>
        {[
          ['held', `Held (${holds.users.length})`],
          ['watch', `Watch (${holds.watch.length})`],
          ['lookup', 'Lookup'],
        ].map(([key, label]) => (
          <TouchableOpacity
            key={key}
            onPress={() => setSection(key)}
            style={{ paddingHorizontal: 14, paddingVertical: 7, borderRadius: 16, marginRight: 8,
              backgroundColor: section === key ? '#007AFF' : c.card, borderWidth: 1, borderColor: section === key ? '#007AFF' : c.border }}
          >
            <Text style={{ color: section === key ? '#fff' : c.text, fontWeight: '600', fontSize: 13 }}>{label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {section === 'lookup' ? (
        <View style={{ flex: 1, paddingHorizontal: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: c.card, borderRadius: 10, paddingHorizontal: 10, marginBottom: 10 }}>
            <Ionicons name="search" size={16} color={c.sub} />
            <TextInput
              value={lookupText}
              onChangeText={setLookupText}
              onSubmitEditing={runLookup}
              placeholder="Trader display name (exact start)"
              placeholderTextColor={c.sub}
              autoCapitalize="none"
              returnKeyType="search"
              style={{ flex: 1, color: c.text, paddingVertical: 10, marginLeft: 6 }}
            />
            {lookupLoading && <ActivityIndicator size="small" color="#007AFF" />}
          </View>
          <FlatList
            data={lookupResults}
            keyExtractor={(u) => u.userId}
            renderItem={({ item }) => (
              <TraderRow who={item} c={c} onPress={() => openTrader(item.userId, { displayName: item.displayName, avatar: item.avatar })} />
            )}
            ListEmptyComponent={<Text style={{ color: c.sub, textAlign: 'center', marginTop: 24 }}>Search is case-sensitive.</Text>}
          />
        </View>
      ) : (
        <FlatList
          data={listData}
          keyExtractor={(u) => u.userId}
          contentContainerStyle={{ padding: 12, paddingTop: 0, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={loadHolds} />}
          ListHeaderComponent={
            <Text style={{ color: c.sub, fontSize: 12, marginBottom: 8 }}>
              {section === 'held'
                ? 'Kept off Top Rated: scam reports are 10%+ of verified reviews (5+), or a moderator hold.'
                : 'Still ranked. Scam reports are 4%+ of verified reviews (3+). Check their chats and decide.'}
              {holds.lastUpdated ? ` Updated ${new Date(holds.lastUpdated).toLocaleString()}.` : ''}
            </Text>
          }
          ListEmptyComponent={!loading && <Text style={{ color: c.sub, textAlign: 'center', marginTop: 24 }}>Nobody here.</Text>}
          renderItem={({ item }) => (
            <TraderRow
              who={identityOf(item.userId)}
              c={c}
              onPress={() => openTrader(item.userId)}
              subtitle={`${item.ratingCount} verified · ${item.scamReports || 0} scam reports (${pct(item.scamReports || 0, item.ratingCount)})${item.reason === 'manual' ? ' · manual hold' : ''}`}
            />
          )}
        />
      )}
    </View>
  );
};

export default ReviewIntegrityTab;
