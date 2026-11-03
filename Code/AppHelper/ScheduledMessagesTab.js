// Admin Dashboard → "Scheduled messages" tab (Senior Mod+, 2026-11-03).
//
// Public-chat posts from the "Announcements" bot (supabase/061_chat_schedules.sql).
//   List   — every schedule: status, channels, next post, Pause / Resume,
//            Edit, Delete.
//   Editor — title; channels, each with its own text (Chinese channel one
//            text, Spanish another); start; repeat interval; stop rule.
// pg_cron posts the due messages every minute, server side, so nothing
// depends on this phone staying open. Every repeating schedule must end
// (a time or a number of posts, max 60 days / 500 posts) and repeats at
// most every 10 minutes; the server refuses anything else.
// Times are typed and shown in the phone's own time zone.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
} from 'react-native';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import { supabase } from '../Supabase/client';
import { showSuccessMessage, showErrorMessage } from '../Helper/MessageHelper';

dayjs.extend(relativeTime);
dayjs.extend(customParseFormat);

const ACCENT = '#0A84FF';
const TIME_FMT = 'YYYY-MM-DD HH:mm';
const START_PRESETS = [
  { key: 'now', label: 'Now', mins: 0 },
  { key: '15m', label: 'In 15 min', mins: 15 },
  { key: '1h', label: 'In 1 h', mins: 60 },
  { key: 'custom', label: 'Pick time' },
];
const REPEAT_PRESETS = [
  { label: 'Once', mins: null },
  { label: '15 min', mins: 15 },
  { label: '30 min', mins: 30 },
  { label: '1 h', mins: 60 },
  { label: '2 h', mins: 120 },
  { label: '6 h', mins: 360 },
  { label: '12 h', mins: 720 },
  { label: '24 h', mins: 1440 },
];
const DURATION_PRESETS = [
  { label: '6 h', hours: 6 },
  { label: '12 h', hours: 12 },
  { label: '1 day', hours: 24 },
  { label: '2 days', hours: 48 },
  { label: '7 days', hours: 168 },
  { label: '30 days', hours: 720 },
];

const ERRORS = {
  NOT_ALLOWED: 'Only Senior Mods and above can schedule messages.',
  BAD_TITLE: 'Give the schedule a title (up to 80 characters).',
  BAD_MESSAGES: 'Pick at least one channel (up to 20).',
  BAD_ROOM: 'One of the channels no longer exists.',
  BAD_TEXT: 'Every channel needs a message of 1 to 500 characters.',
  BAD_START: 'The start time must be now or later (within 90 days).',
  BAD_INTERVAL: 'Repeat every 10 minutes to 7 days.',
  MUST_END: 'A repeating message needs an end time or a number of posts.',
  BAD_END: 'The end must be after the start and at most 60 days later.',
  BAD_MAX_RUNS: 'Number of posts must be 1 to 500.',
  NOT_FOUND: 'That schedule was deleted.',
};

// Supabase error -> text. 061 not applied -> a clear hint.
const rpcError = (error) => {
  const code = error?.code || '';
  const msg = String(error?.message || error || '');
  if (['PGRST202', '42883', '42P01'].includes(code) || /could not find the function/i.test(msg)) {
    return 'Scheduled messages are not set up yet (supabase/061_chat_schedules.sql has not been run).';
  }
  const key = Object.keys(ERRORS).find((k) => msg.includes(k));
  if (key) return ERRORS[key];
  if (code === '42501') return ERRORS.NOT_ALLOWED;
  return msg || 'Something went wrong.';
};

const everyLabel = (mins) => {
  if (!mins) return 'Once';
  if (mins % 1440 === 0) return `Every ${mins / 1440} day${mins === 1440 ? '' : 's'}`;
  if (mins % 60 === 0) return `Every ${mins / 60} h`;
  return `Every ${mins} min`;
};

// How many posts start..end at this interval, capped by maxRuns.
const countPosts = (startMs, everyMins, endMs, maxRuns) => {
  if (!everyMins) return 1;
  let n = endMs ? Math.floor((endMs - startMs) / (everyMins * 60000)) + 1 : Infinity;
  if (maxRuns) n = Math.min(n, maxRuns);
  return Number.isFinite(n) ? Math.max(n, 0) : null;
};

const statusOf = (row) => {
  if (row.next_run_at && row.active) return { label: 'Active', color: '#34C759' };
  if (row.next_run_at) return { label: 'Paused', color: '#FF9500' };
  return { label: 'Finished', color: '#8E8E93' };
};

const Pill = ({ label, active, onPress, isDark, color }) => (
  <TouchableOpacity
    onPress={onPress}
    style={{
      paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, marginRight: 8, marginBottom: 8,
      backgroundColor: active ? (color || ACCENT) : (isDark ? '#2C2C2E' : '#E5E5EA'),
    }}
  >
    <Text style={{ fontSize: 12, fontWeight: '700', color: active ? '#FFF' : (isDark ? '#CCC' : '#333') }}>{label}</Text>
  </TouchableOpacity>
);

const Chip = ({ label, color }) => (
  <View style={{ backgroundColor: color + '22', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, marginRight: 6 }}>
    <Text style={{ color, fontSize: 11, fontWeight: '700' }}>{label}</Text>
  </View>
);

const emptyDraft = () => ({
  id: null,
  title: '',
  texts: {},            // room id -> text
  order: [],            // room ids in the order picked
  startKey: 'now',
  startText: dayjs().add(1, 'hour').startOf('hour').format(TIME_FMT),
  every: null,
  customEvery: '',
  durationHours: 48,
  customHours: '',
  maxRuns: '',
});

const draftFromRow = (row) => ({
  id: row.id,
  title: row.title,
  texts: Object.fromEntries((row.messages || []).map((m) => [m.room_id, m.text])),
  order: (row.messages || []).map((m) => m.room_id),
  startKey: 'custom',
  startText: dayjs(row.start_at).format(TIME_FMT),
  keepStart: row.start_at,
  every: row.interval_minutes || null,
  customEvery: REPEAT_PRESETS.some((p) => p.mins === row.interval_minutes) ? '' : String(row.interval_minutes || ''),
  durationHours: null,
  customHours: row.end_at ? String(Math.round(dayjs(row.end_at).diff(dayjs(row.start_at), 'minute') / 6) / 10) : '',
  maxRuns: row.max_runs ? String(row.max_runs) : '',
});

const ScheduledMessagesTab = ({ isDark, currentUser }) => {
  const [rows, setRows] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState(null);
  const [draft, setDraft] = useState(null);   // null = list view
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const text = isDark ? '#FFF' : '#000';
  const sub = isDark ? '#999' : '#666';
  const card = isDark ? '#1C1C1E' : '#FFF';
  const border = isDark ? '#2C2C2E' : '#E5E5EA';
  const inputStyle = {
    borderWidth: 1, borderColor: border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8,
    color: text, backgroundColor: card, fontSize: 14,
  };
  const label = { color: sub, fontSize: 12, fontWeight: '700', marginTop: 14, marginBottom: 6, textTransform: 'uppercase' };
  const roomLabel = useCallback((id) => rooms.find((r) => r.id === id)?.label || id, [rooms]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('chat_schedules_list');
      if (error) throw error;
      setRows(Array.isArray(data?.rows) ? data.rows : []);
      setRooms(Array.isArray(data?.rooms) ? data.rooms : []);
      setProblem(null);
    } catch (e) {
      setProblem(rpcError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const patch = (p) => setDraft((d) => ({ ...d, ...p }));

  // ── Draft -> schedule fields (null + reason when incomplete) ──
  const plan = useMemo(() => {
    if (!draft) return null;
    let startMs;
    if (draft.startKey === 'custom') {
      const d = dayjs(draft.startText.trim(), TIME_FMT, true);
      if (!d.isValid()) return { why: `Type the start as ${TIME_FMT}.` };
      startMs = d.valueOf();
      // An edit that keeps its old start keeps the exact server value.
      if (draft.keepStart && dayjs(draft.keepStart).format(TIME_FMT) === draft.startText.trim()) {
        startMs = new Date(draft.keepStart).getTime();
      }
    } else {
      startMs = Date.now() + (START_PRESETS.find((p) => p.key === draft.startKey)?.mins || 0) * 60000;
    }
    const every = draft.customEvery ? parseInt(draft.customEvery, 10) : draft.every;
    if (draft.customEvery && !(every >= 10 && every <= 10080)) return { why: 'Repeat every 10 to 10080 minutes.' };
    const hours = draft.customHours ? parseFloat(draft.customHours) : draft.durationHours;
    const maxRuns = draft.maxRuns ? parseInt(draft.maxRuns, 10) : null;
    if (draft.maxRuns && !(maxRuns >= 1 && maxRuns <= 500)) return { why: 'Number of posts must be 1 to 500.' };
    if (every && !hours && !maxRuns) return { why: 'Pick how long it runs, or a number of posts.' };
    if (every && hours && !(hours > 0 && hours <= 1440)) return { why: 'Run for at most 60 days.' };
    const endMs = every && hours ? startMs + hours * 3600000 : null;
    return { startMs, every: every || null, endMs, maxRuns: every ? maxRuns : null };
  }, [draft]);

  const posts = plan && !plan.why ? countPosts(plan.startMs, plan.every, plan.endMs, plan.maxRuns) : null;
  const totalMessages = posts != null && draft ? posts * draft.order.length : null;

  const save = async () => {
    if (!draft || !plan || plan.why) return;
    const messages = draft.order.map((id) => ({ room_id: id, text: (draft.texts[id] || '').trim() }));
    if (!draft.title.trim()) return showErrorMessage('Error', ERRORS.BAD_TITLE);
    if (messages.length === 0) return showErrorMessage('Error', ERRORS.BAD_MESSAGES);
    const missing = messages.find((m) => !m.text);
    if (missing) return showErrorMessage('Error', `Write the message for ${roomLabel(missing.room_id)}.`);

    const go = async () => {
      setSaving(true);
      try {
        const { error } = await supabase.rpc('chat_schedule_save', {
          p: {
            id: draft.id,
            title: draft.title.trim(),
            messages,
            start_at: new Date(plan.startMs).toISOString(),
            interval_minutes: plan.every,
            end_at: plan.endMs ? new Date(plan.endMs).toISOString() : null,
            max_runs: plan.maxRuns,
            by_name: currentUser?.displayName || null,
          },
        });
        if (error) throw error;
        showSuccessMessage('Saved', draft.id ? 'Schedule updated.' : 'Schedule created.');
        setDraft(null);
        load();
      } catch (e) {
        showErrorMessage('Error', rpcError(e));
      } finally {
        setSaving(false);
      }
    };
    // Big blasts get a second look.
    if (totalMessages != null && totalMessages > 50) {
      Alert.alert('Many messages', `This posts ${totalMessages} messages in total. Continue?`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Save', onPress: go },
      ]);
    } else {
      go();
    }
  };

  const setActive = async (row, active) => {
    setBusyId(row.id);
    try {
      const { error } = await supabase.rpc('chat_schedule_set_active', { p_id: row.id, p_active: active });
      if (error) throw error;
      load();
    } catch (e) {
      showErrorMessage('Error', rpcError(e));
    } finally {
      setBusyId(null);
    }
  };

  const remove = (row) => {
    Alert.alert('Delete schedule', `Delete "${row.title}"? Messages already posted stay in chat.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          setBusyId(row.id);
          try {
            const { error } = await supabase.rpc('chat_schedule_delete', { p_id: row.id });
            if (error) throw error;
            setRows((prev) => prev.filter((r) => r.id !== row.id));
          } catch (e) {
            showErrorMessage('Error', rpcError(e));
          } finally {
            setBusyId(null);
          }
        },
      },
    ]);
  };

  // ───────────────────────── Editor ─────────────────────────
  if (draft) {
    const toggleRoom = (id) => setDraft((d) => (d.order.includes(id)
      ? { ...d, order: d.order.filter((x) => x !== id) }
      : { ...d, order: [...d.order, id] }));
    const copyFirst = () => {
      const first = draft.texts[draft.order[0]] || '';
      setDraft((d) => ({ ...d, texts: Object.fromEntries(d.order.map((id) => [id, first])) }));
    };
    return (
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={{ color: text, fontSize: 18, fontWeight: '800' }}>{draft.id ? 'Edit schedule' : 'New schedule'}</Text>
          <TouchableOpacity onPress={() => setDraft(null)}>
            <Text style={{ color: ACCENT, fontWeight: '700' }}>Cancel</Text>
          </TouchableOpacity>
        </View>
        <Text style={{ color: sub, fontSize: 12, marginTop: 4 }}>Posted by the Announcements bot (BOT tag), not by you.</Text>

        <Text style={label}>Title (staff only)</Text>
        <TextInput style={inputStyle} value={draft.title} onChangeText={(v) => patch({ title: v })} maxLength={80}
          placeholder="e.g. Weekend event reminder" placeholderTextColor={sub} />

        <Text style={label}>Channels</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {rooms.map((r) => (
            <Pill key={r.id} label={r.label} isDark={isDark} active={draft.order.includes(r.id)} onPress={() => toggleRoom(r.id)} />
          ))}
        </View>

        {draft.order.length > 0 && (
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={label}>Message per channel</Text>
            {draft.order.length > 1 && (
              <TouchableOpacity onPress={copyFirst}>
                <Text style={{ color: ACCENT, fontSize: 12, fontWeight: '700', marginTop: 8 }}>Copy first to all</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
        {draft.order.map((id) => (
          <View key={id} style={{ marginBottom: 10 }}>
            <Text style={{ color: text, fontWeight: '700', marginBottom: 4 }}>{roomLabel(id)}</Text>
            <TextInput
              style={[inputStyle, { minHeight: 70, textAlignVertical: 'top' }]}
              multiline maxLength={500}
              value={draft.texts[id] || ''}
              onChangeText={(v) => setDraft((d) => ({ ...d, texts: { ...d.texts, [id]: v } }))}
              placeholder="Message text" placeholderTextColor={sub}
            />
            <Text style={{ color: sub, fontSize: 11, textAlign: 'right' }}>{(draft.texts[id] || '').length}/500</Text>
          </View>
        ))}

        <Text style={label}>Start</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {START_PRESETS.map((p) => (
            <Pill key={p.key} label={p.label} isDark={isDark} active={draft.startKey === p.key} onPress={() => patch({ startKey: p.key })} />
          ))}
        </View>
        {draft.startKey === 'custom' && (
          <TextInput style={inputStyle} value={draft.startText} onChangeText={(v) => patch({ startText: v })}
            placeholder={TIME_FMT} placeholderTextColor={sub} autoCapitalize="none" autoCorrect={false} />
        )}
        <Text style={{ color: sub, fontSize: 11, marginTop: 4 }}>Your time zone: UTC{dayjs().format('Z')}</Text>

        <Text style={label}>Repeat</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {REPEAT_PRESETS.map((p) => (
            <Pill key={p.label} label={p.label} isDark={isDark}
              active={!draft.customEvery && draft.every === p.mins}
              onPress={() => patch({ every: p.mins, customEvery: '' })} />
          ))}
        </View>
        <TextInput style={inputStyle} value={draft.customEvery} keyboardType="number-pad"
          onChangeText={(v) => patch({ customEvery: v.replace(/\D/g, '') })}
          placeholder="or every … minutes (10 or more)" placeholderTextColor={sub} />

        {(draft.every || draft.customEvery) ? (
          <>
            <Text style={label}>Keep posting for</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {DURATION_PRESETS.map((p) => (
                <Pill key={p.label} label={p.label} isDark={isDark}
                  active={!draft.customHours && draft.durationHours === p.hours}
                  onPress={() => patch({ durationHours: p.hours, customHours: '' })} />
              ))}
            </View>
            <TextInput style={inputStyle} value={draft.customHours} keyboardType="decimal-pad"
              onChangeText={(v) => patch({ customHours: v.replace(/[^\d.]/g, ''), durationHours: null })}
              placeholder="or … hours (max 1440 = 60 days)" placeholderTextColor={sub} />
            <Text style={label}>Stop after (optional)</Text>
            <TextInput style={inputStyle} value={draft.maxRuns} keyboardType="number-pad"
              onChangeText={(v) => patch({ maxRuns: v.replace(/\D/g, '') })}
              placeholder="… posts per channel (max 500)" placeholderTextColor={sub} />
          </>
        ) : null}

        <View style={{ marginTop: 16, padding: 12, borderRadius: 10, backgroundColor: isDark ? '#2C2C2E' : '#F2F2F7' }}>
          {plan?.why ? (
            <Text style={{ color: '#FF9500', fontWeight: '600' }}>{plan.why}</Text>
          ) : plan ? (
            <Text style={{ color: text, lineHeight: 20 }}>
              {`First post ${dayjs(plan.startMs).format('ddd D MMM, HH:mm')}. ${everyLabel(plan.every)}`}
              {plan.endMs ? `, until ${dayjs(plan.endMs).format('ddd D MMM, HH:mm')}` : ''}
              {posts != null ? `. ${posts} post${posts === 1 ? '' : 's'} per channel` : ''}
              {totalMessages != null && draft.order.length > 1 ? ` (${totalMessages} messages in total)` : ''}.
            </Text>
          ) : null}
        </View>

        <TouchableOpacity
          onPress={save}
          disabled={saving || !!plan?.why}
          style={{ marginTop: 16, backgroundColor: ACCENT, borderRadius: 12, paddingVertical: 14, alignItems: 'center', opacity: saving || plan?.why ? 0.5 : 1 }}
        >
          {saving ? <ActivityIndicator color="#FFF" /> : <Text style={{ color: '#FFF', fontWeight: '800' }}>{draft.id ? 'Save changes' : 'Create schedule'}</Text>}
        </TouchableOpacity>
      </ScrollView>
    );
  }

  // ───────────────────────── List ─────────────────────────
  return (
    <View style={{ flex: 1 }}>
      <View style={{ padding: 16, paddingBottom: 8 }}>
        <TouchableOpacity
          onPress={() => setDraft(emptyDraft())}
          disabled={!!problem}
          style={{ backgroundColor: ACCENT, borderRadius: 12, paddingVertical: 12, alignItems: 'center', opacity: problem ? 0.5 : 1 }}
        >
          <Text style={{ color: '#FFF', fontWeight: '800' }}>+ New scheduled message</Text>
        </TouchableOpacity>
        {problem ? <Text style={{ color: '#FF3B30', marginTop: 10 }}>{problem}</Text> : null}
      </View>
      <FlatList
        data={rows}
        keyExtractor={(r) => r.id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        ListEmptyComponent={!loading && !problem ? (
          <Text style={{ color: sub, textAlign: 'center', marginTop: 30 }}>No scheduled messages yet.</Text>
        ) : null}
        renderItem={({ item: row }) => {
          const st = statusOf(row);
          const finished = !row.next_run_at;
          const total = countPosts(new Date(row.start_at).getTime(), row.interval_minutes,
            row.end_at ? new Date(row.end_at).getTime() : null, row.max_runs);
          return (
            <View style={{ backgroundColor: card, borderRadius: 12, borderWidth: 1, borderColor: border, padding: 12, marginBottom: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
                <Chip label={st.label} color={st.color} />
                <Text style={{ color: text, fontWeight: '800', flex: 1 }} numberOfLines={1}>{row.title}</Text>
              </View>
              <Text style={{ color: sub, fontSize: 12 }} numberOfLines={2}>
                {(row.messages || []).map((m) => roomLabel(m.room_id)).join(' · ')}
              </Text>
              <Text style={{ color: text, fontSize: 13, marginTop: 6 }} numberOfLines={2}>
                {(row.messages || [])[0]?.text}
              </Text>
              <Text style={{ color: sub, fontSize: 12, marginTop: 6 }}>
                {everyLabel(row.interval_minutes)} · {row.runs_done}{total != null ? `/${total}` : ''} posted
                {row.next_run_at && row.active ? ` · next ${dayjs(row.next_run_at).fromNow()}` : ''}
                {row.end_at ? ` · ends ${dayjs(row.end_at).format('D MMM HH:mm')}` : ''}
              </Text>
              {row.created_by_name ? <Text style={{ color: sub, fontSize: 11, marginTop: 2 }}>by {row.created_by_name}</Text> : null}
              {row.last_error ? <Text style={{ color: '#FF3B30', fontSize: 11, marginTop: 4 }}>Last error: {row.last_error}</Text> : null}
              <View style={{ flexDirection: 'row', marginTop: 10, alignItems: 'center' }}>
                {busyId === row.id ? <ActivityIndicator style={{ marginRight: 12 }} /> : null}
                {!finished && (
                  <Pill label={row.active ? 'Pause' : 'Resume'} isDark={isDark} active color={row.active ? '#FF9500' : '#34C759'}
                    onPress={() => setActive(row, !row.active)} />
                )}
                <Pill label="Edit" isDark={isDark} onPress={() => setDraft(draftFromRow(row))} />
                <Pill label="Delete" isDark={isDark} onPress={() => remove(row)} />
              </View>
            </View>
          );
        }}
      />
    </View>
  );
};

export default ScheduledMessagesTab;
