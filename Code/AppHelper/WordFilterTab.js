// Admin Dashboard → "Word filter" tab (Senior Mod+, 2026-10).
//
// Edits the global blocklist (supabase/049_word_filter.sql, word_blocklist):
//   List  — every term, newest change first; tap a term to turn it off / on.
//           Adding a term that exists re-enables / re-classifies it.
//   Hits  — posts, comments and statuses the server masked
//           (functions/wordFilterContent.js), with the original text, so a
//           false positive can be put back by hand.
//   Test  — what the app's matcher and the server say about any text.
// The add bar sits at the top of the list (Senior Mod test 2026-10-20 could
// not find the old "Add" toggle); kind, mode, language and note are under
// "More options".
// Kinds: slur and offensive (blocked everywhere: the server rejects them in
// every chat at once, for every build (052), masks them in posts, comments
// and statuses, and refuses them in names), spam (the app blocks it), allow
// (innocent phrases cut out before matching).
// Turning off a word that ships inside the app (its old English list) stores
// it switched off, so every app drops it at its next list refresh (≤ 12 h).
// Only Senior Mods and above pass the rpcs; others see "not allowed".

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Alert,
  Keyboard,
  RefreshControl,
  ScrollView,
} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { supabase } from '../Supabase/client';
import { showSuccessMessage, showErrorMessage } from '../Helper/MessageHelper';
import { normalize, termKey, termPattern } from '../Helper/wordFilterCore';
import { findBlockedTerms, refreshWordFilter, validateUsername } from '../Helper/ContentModeration';

dayjs.extend(relativeTime);

const KINDS = ['slur', 'offensive', 'spam', 'allow'];
const MODES = ['auto', 'word', 'exact', 'part'];
const KIND_COLOR = { slur: '#FF3B30', offensive: '#FF9500', spam: '#AF52DE', allow: '#34C759' };
const FILTERS = [null, ...KINDS, 'off'];
const LANG_RE = /^[a-z]{2,3}$/;

// Supabase error -> text. 049 not applied -> a clear hint.
const rpcError = (error) => {
  const code = error?.code || '';
  const msg = String(error?.message || error || '');
  if (['PGRST202', '42883', '42P01'].includes(code) || /could not find the function/i.test(msg)) {
    return 'The word filter is not set up yet (supabase/049_word_filter.sql has not been run).';
  }
  if (/NOT_ALLOWED/.test(msg) || code === '42501') return 'Only Senior Mods and above can edit the word filter.';
  if (/TERM_EMPTY/.test(msg)) return 'That term has no letters or digits once normalised.';
  return msg || 'Something went wrong.';
};

const Pill = ({ label, active, onPress, isDark, color }) => (
  <TouchableOpacity
    onPress={onPress}
    style={{
      paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, marginRight: 8,
      backgroundColor: active ? (color || '#007AFF') : (isDark ? '#2C2C2E' : '#E5E5EA'),
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

const WordFilterTab = ({ isDark, currentUser }) => {
  const [view, setView] = useState('list'); // 'list' | 'hits' | 'test'
  const [rows, setRows] = useState([]);
  const [version, setVersion] = useState(null);
  const [hits, setHits] = useState([]);
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState(null);
  const [filter, setFilter] = useState(null);
  const [search, setSearch] = useState('');
  const [showOptions, setShowOptions] = useState(false);
  const [term, setTerm] = useState('');
  const [kind, setKind] = useState('offensive');
  const [mode, setMode] = useState('auto');
  const [lang, setLang] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(null); // term key being written
  const [sample, setSample] = useState('');
  const [serverSays, setServerSays] = useState(undefined);

  const text = isDark ? '#FFF' : '#000';
  const sub = isDark ? '#999' : '#666';
  const card = isDark ? '#1C1C1E' : '#FFF';
  const border = isDark ? '#2C2C2E' : '#E5E5EA';
  const inputStyle = {
    borderWidth: 1, borderColor: border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8,
    color: text, backgroundColor: card, fontSize: 14,
  };
  const myName = currentUser?.displayName || null;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (view === 'hits') {
        const { data, error } = await supabase.rpc('word_filter_hits_list', { p_limit: 100 });
        if (error) throw error;
        setHits(Array.isArray(data) ? data : []);
      } else {
        const { data, error } = await supabase.rpc('word_filter_admin_list');
        if (error) throw error;
        setRows(Array.isArray(data?.rows) ? data.rows : []);
        setVersion(data?.v ?? null);
      }
      setProblem(null);
    } catch (e) {
      setProblem(rpcError(e));
    } finally {
      setLoading(false);
    }
  }, [view]);

  useEffect(() => { if (view !== 'test') load(); }, [view, load]);

  const visible = useMemo(() => {
    const q = termKey(search);
    const raw = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === 'off' && r.active) return false;
      if (filter && filter !== 'off' && (!r.active || r.kind !== filter)) return false;
      return !raw || String(r.key || '').includes(q) || String(r.term || '').toLowerCase().includes(raw);
    });
  }, [rows, filter, search]);

  const afterWrite = useCallback(async (message) => {
    showSuccessMessage('Saved', message);
    refreshWordFilter(); // this phone picks the change up at once
    await load();
  }, [load]);

  const add = useCallback(async () => {
    const t = term.trim();
    if (!t) return;
    if (lang.trim() && !LANG_RE.test(lang.trim().toLowerCase())) {
      Alert.alert('Language', 'Use a 2–3 letter code (en, es, pt, fr, de, ru, id, fil, vi, ar…) or leave it empty.');
      return;
    }
    Keyboard.dismiss();
    setSaving(t);
    try {
      const { error } = await supabase.rpc('word_filter_add', {
        p_term: t, p_kind: kind, p_mode: mode, p_lang: lang.trim().toLowerCase() || null,
        p_note: note.trim() || null, p_name: myName,
      });
      if (error) throw error;
      setTerm('');
      setNote('');
      await afterWrite(`"${t}" is now ${kind === 'allow' ? 'allowed' : 'blocked'} (${kind}).`);
    } catch (e) {
      showErrorMessage('Not saved', rpcError(e));
    } finally {
      setSaving(null);
    }
  }, [term, kind, mode, lang, note, myName, afterWrite]);

  const toggle = useCallback((r) => {
    const turnOff = r.active;
    Alert.alert(
      turnOff ? `Turn off "${r.term}"?` : `Turn "${r.term}" back on?`,
      turnOff
        ? 'Chat stops blocking it at once; apps drop it at their next list refresh (within 12 hours).'
        : `It will be blocked again as ${r.kind}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: turnOff ? 'Turn off' : 'Turn on',
          style: turnOff ? 'destructive' : 'default',
          onPress: async () => {
            setSaving(r.key);
            try {
              const { error } = turnOff
                ? await supabase.rpc('word_filter_remove', { p_term: r.term, p_name: myName })
                : await supabase.rpc('word_filter_add', { p_term: r.term, p_kind: r.kind, p_mode: r.mode, p_lang: r.lang || null, p_note: null, p_name: myName });
              if (error) throw error;
              await afterWrite(turnOff ? `"${r.term}" is off.` : `"${r.term}" is on.`);
            } catch (e) {
              showErrorMessage('Not saved', rpcError(e));
            } finally {
              setSaving(null);
            }
          },
        },
      ],
    );
  }, [myName, afterWrite]);

  const checkOnServer = useCallback(async () => {
    setServerSays(null);
    try {
      const { data, error } = await supabase.rpc('word_filter_check', { p_text: sample, p_names: true });
      if (error) throw error;
      setServerSays(data || 'clean');
    } catch (e) {
      setServerSays(rpcError(e));
    }
  }, [sample]);

  const copy = (value, label) => {
    Clipboard.setString(String(value || ''));
    showSuccessMessage('Copied', label);
  };

  const preview = term.trim() ? termPattern(term, mode, kind) : null;

  const renderRow = ({ item: r }) => (
    <TouchableOpacity
      onPress={() => toggle(r)}
      onLongPress={() => copy(r.term, 'Term copied')}
      disabled={saving === r.key}
      activeOpacity={0.8}
      style={{ backgroundColor: card, borderRadius: 12, padding: 12, marginHorizontal: 12, marginBottom: 8, opacity: r.active ? 1 : 0.55 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text style={{ color: text, fontSize: 15, fontWeight: '800', flex: 1 }} numberOfLines={1}>{r.term}</Text>
        {saving === r.key
          ? <ActivityIndicator size="small" />
          : <Text style={{ color: r.active ? '#34C759' : sub, fontSize: 12, fontWeight: '700' }}>{r.active ? 'ON' : 'OFF'}</Text>}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
        <Chip label={r.kind} color={KIND_COLOR[r.kind] || sub} />
        <Chip label={r.mode} color={sub} />
        {!!r.lang && <Chip label={r.lang} color="#0A84FF" />}
        {r.key !== String(r.term).toLowerCase() && <Text style={{ color: sub, fontSize: 11 }}>matches as “{r.key}”</Text>}
      </View>
      {!!r.note && <Text style={{ color: sub, fontSize: 12, marginTop: 4 }} numberOfLines={2}>{r.note}</Text>}
      <Text style={{ color: sub, fontSize: 11, marginTop: 4 }}>
        {r.addedBy ? `by ${r.addedByName || r.addedBy}` : 'seed'}
        {r.updatedAt ? ` · ${dayjs(r.updatedAt).fromNow()}` : ''}
      </Text>
    </TouchableOpacity>
  );

  const renderHit = ({ item: h }) => (
    <TouchableOpacity
      onPress={() => copy(h.original, 'Original text copied')}
      onLongPress={() => copy(h.docPath, 'Document path copied')}
      activeOpacity={0.8}
      style={{ backgroundColor: card, borderRadius: 12, padding: 12, marginHorizontal: 12, marginBottom: 8 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ color: text, fontWeight: '800', fontSize: 13 }}>{h.source} · {h.field}</Text>
        <Text style={{ color: sub, fontSize: 11 }}>{h.createdAt ? dayjs(h.createdAt).fromNow() : ''}</Text>
      </View>
      <Text style={{ color: text, fontSize: 13, marginTop: 4 }} numberOfLines={3}>{h.original}</Text>
      <Text style={{ color: sub, fontSize: 12, marginTop: 2 }} numberOfLines={2}>→ {h.masked}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 6 }}>
        {(h.terms || []).map((t) => <Chip key={t} label={t} color={KIND_COLOR.slur} />)}
      </View>
      <Text style={{ color: sub, fontSize: 10, fontFamily: 'monospace', marginTop: 4 }} numberOfLines={1}>{h.docPath}{h.uid ? ` · ${h.uid}` : ''}</Text>
    </TouchableOpacity>
  );

  const empty = (
    <View style={{ padding: 32, alignItems: 'center' }}>
      {loading
        ? <ActivityIndicator />
        : <Text style={{ color: sub, textAlign: 'center' }}>{problem || (view === 'hits' ? 'Nothing masked yet.' : 'No terms match.')}</Text>}
    </View>
  );

  const addForm = (
    <View style={{ backgroundColor: card, borderRadius: 12, padding: 12, marginHorizontal: 12, marginBottom: 8 }}>
      <Text style={{ color: text, fontSize: 14, fontWeight: '800', marginBottom: 8 }}>Add a word</Text>
      <View style={{ flexDirection: 'row' }}>
        <TextInput
          value={term}
          onChangeText={setTerm}
          placeholder="Word or phrase"
          placeholderTextColor={sub}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          onSubmitEditing={() => { if (preview && !saving) add(); }}
          style={[inputStyle, { flex: 1, marginRight: 8 }]}
        />
        <TouchableOpacity
          onPress={add}
          disabled={!preview || !!saving}
          style={{ backgroundColor: preview && !saving ? '#007AFF' : border, borderRadius: 10, paddingHorizontal: 16, justifyContent: 'center' }}
        >
          {saving && saving === term.trim()
            ? <ActivityIndicator color="#FFF" />
            : <Text style={{ color: '#FFF', fontWeight: '800' }}>{kind === 'allow' ? 'Allow' : 'Block'}</Text>}
        </TouchableOpacity>
      </View>
      {!!term.trim() && (
        <Text style={{ color: preview ? sub : '#FF3B30', fontSize: 11, marginTop: 6, fontFamily: 'monospace' }}>
          {preview ? `${kind} · matches as “${termKey(term)}” · ${preview}` : 'No letters or digits: nothing to match.'}
        </Text>
      )}
      <TouchableOpacity onPress={() => setShowOptions((v) => !v)} style={{ marginTop: 8, alignSelf: 'flex-start' }}>
        <Text style={{ color: '#007AFF', fontSize: 12, fontWeight: '700' }}>{showOptions ? 'Fewer options' : 'More options'}</Text>
      </TouchableOpacity>
      {showOptions && (
        <View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
            {KINDS.map((k) => <Pill key={k} label={k} active={kind === k} onPress={() => setKind(k)} isDark={isDark} color={KIND_COLOR[k]} />)}
          </ScrollView>
          {kind !== 'allow' && (
            <View style={{ flexDirection: 'row', marginTop: 8 }}>
              {MODES.map((m) => <Pill key={m} label={m} active={mode === m} onPress={() => setMode(m)} isDark={isDark} />)}
            </View>
          )}
          <Text style={{ color: sub, fontSize: 11, marginTop: 6 }}>
            {kind === 'allow'
              ? 'Allow: this whole phrase is cut out before matching (e.g. "en retard" = French for "late").'
              : 'slur / offensive: blocked in every chat at once. spam: blocked by the app. auto: whole word for short terms (spic ≠ spicy), inside words for 5+ letters. word: whole word (+ plural s). exact: whole word, no plural. part: inside any word.'}
          </Text>
          <View style={{ flexDirection: 'row', marginTop: 8 }}>
            <TextInput
              value={lang}
              onChangeText={setLang}
              placeholder="lang"
              placeholderTextColor={sub}
              autoCapitalize="none"
              maxLength={3}
              style={[inputStyle, { width: 70, marginRight: 8 }]}
            />
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="Note (why, where it's used)"
              placeholderTextColor={sub}
              maxLength={300}
              style={[inputStyle, { flex: 1 }]}
            />
          </View>
        </View>
      )}
    </View>
  );

  const found = sample.trim() ? findBlockedTerms(sample) : null;
  const nameOk = sample.trim() ? validateUsername(sample).isValid : true;

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8 }}>
        <Pill label="List" active={view === 'list'} onPress={() => setView('list')} isDark={isDark} />
        <Pill label="Hits" active={view === 'hits'} onPress={() => setView('hits')} isDark={isDark} />
        <Pill label="Test" active={view === 'test'} onPress={() => setView('test')} isDark={isDark} />
        <View style={{ flex: 1 }} />
        {view === 'list' && version != null && <Text style={{ color: sub, fontSize: 11 }}>v{version} · {rows.filter((r) => r.active).length} on</Text>}
      </View>

      {view === 'list' && (
        <FlatList
          data={visible}
          keyExtractor={(r) => String(r.id)}
          renderItem={renderRow}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={(
            <View>
              {addForm}
              <View style={{ paddingHorizontal: 12, marginBottom: 8 }}>
                <TextInput
                  value={search}
                  onChangeText={setSearch}
                  placeholder="Search terms"
                  placeholderTextColor={sub}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={inputStyle}
                />
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 8 }}>
                {FILTERS.map((f) => (
                  <Pill key={f || 'all'} label={f || 'all'} active={filter === f} onPress={() => setFilter(f)} isDark={isDark} color={KIND_COLOR[f]} />
                ))}
              </ScrollView>
            </View>
          )}
          ListEmptyComponent={empty}
          refreshControl={<RefreshControl refreshing={loading && rows.length > 0} onRefresh={load} />}
        />
      )}

      {view === 'hits' && (
        <FlatList
          data={hits}
          keyExtractor={(h) => String(h.id)}
          renderItem={renderHit}
          ListHeaderComponent={<Text style={{ color: sub, fontSize: 11, marginHorizontal: 12, marginBottom: 8 }}>Tap: copy the original text. Long press: copy the document path.</Text>}
          ListEmptyComponent={empty}
          refreshControl={<RefreshControl refreshing={loading && hits.length > 0} onRefresh={load} />}
        />
      )}

      {view === 'test' && (
        <ScrollView contentContainerStyle={{ padding: 12 }} keyboardShouldPersistTaps="handled">
          <TextInput
            value={sample}
            onChangeText={(v) => { setSample(v); setServerSays(undefined); }}
            placeholder="Type any message or name"
            placeholderTextColor={sub}
            autoCapitalize="none"
            autoCorrect={false}
            multiline
            style={[inputStyle, { minHeight: 70, textAlignVertical: 'top' }]}
          />
          {!!found && (
            <View style={{ backgroundColor: card, borderRadius: 12, padding: 12, marginTop: 10 }}>
              <Text style={{ color: sub, fontSize: 11 }}>The app reads it as</Text>
              <Text style={{ color: text, fontSize: 12, fontFamily: 'monospace', marginTop: 2 }}>{normalize(sample).trim()}</Text>
              {KINDS.filter((k) => k !== 'allow').map((k) => (
                <Text key={k} style={{ color: found[k].length ? KIND_COLOR[k] : sub, fontSize: 13, marginTop: 6, fontWeight: '600' }}>
                  {k}: {found[k].length ? found[k].join(', ') : '—'}
                </Text>
              ))}
              <Text style={{ color: nameOk ? sub : KIND_COLOR.offensive, fontSize: 13, marginTop: 6 }}>
                as a username: {nameOk ? 'allowed' : 'refused'}
              </Text>
              <TouchableOpacity onPress={checkOnServer} style={{ marginTop: 10, alignSelf: 'flex-start' }}>
                <Text style={{ color: '#007AFF', fontWeight: '700' }}>Check on the server</Text>
              </TouchableOpacity>
              {serverSays !== undefined && (
                <Text style={{ color: text, fontSize: 13, marginTop: 4 }}>
                  {serverSays === null ? 'Checking…' : `Server: ${serverSays}`}
                </Text>
              )}
            </View>
          )}
          <Text style={{ color: sub, fontSize: 11, marginTop: 10 }}>
            The app also blocks its old English profanity list, spam phrases, adult words and links. The server blocks slurs and offensive words in every chat and in names, and masks them in posts, comments and statuses.
          </Text>
        </ScrollView>
      )}
    </View>
  );
};

export default WordFilterTab;
