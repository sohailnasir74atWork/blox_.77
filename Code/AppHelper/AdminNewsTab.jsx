/**
 * AdminNewsTab — the Admin Dashboard's News tab: write a post (heading + text)
 * for More ▸ News, and edit or delete the ones already up. Posting goes
 * straight to every player, so it asks first. Admin-only, enforced by the
 * /news/updates/$id rule (Code/ValuesScreen/newsApi.js).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, FlatList, ActivityIndicator, Alert, RefreshControl, StyleSheet,
} from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { fetchNews, saveNews, deleteNews, NEWS_TITLE_MAX, NEWS_BODY_MAX } from '../ValuesScreen/newsApi';

const fmtDate = (ms) => (ms ? new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'No date');

export default function AdminNewsTab({ db, uid, C, accent, danger, bottomInset = 0 }) {
  const [items, setItems] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const listRef = useRef(null);

  const load = useCallback(async () => {
    try {
      setItems(await fetchNews(db));
    } catch (e) {
      setItems((prev) => prev || []);
      Alert.alert('Could not load news', e?.message || 'Try again.');
    }
  }, [db]);

  useEffect(() => { load(); }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const resetForm = () => { setEditing(null); setTitle(''); setBody(''); };

  const startEdit = (item) => {
    setEditing(item);
    setTitle(item.title);
    setBody(item.body);
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
  };

  const canSave = title.trim().length > 0 && body.trim().length > 0 && !saving;

  const doSave = async () => {
    setSaving(true);
    try {
      await saveNews(db, uid, { id: editing?.id, title, body, createdAt: editing?.createdAt });
      resetForm();
      await load();
    } catch (e) {
      Alert.alert('Not saved', e?.message || 'Try again.');
    } finally {
      setSaving(false);
    }
  };

  const confirmSave = () => {
    if (!canSave) return;
    Alert.alert(
      editing ? 'Save changes?' : 'Post this news?',
      editing
        ? 'Players see the new text, marked "Updated" with today\'s date.'
        : 'Every player sees it in More ▸ News straight away.',
      [{ text: 'Cancel', style: 'cancel' }, { text: editing ? 'Save' : 'Post', onPress: doSave }],
    );
  };

  const confirmDelete = (item) => {
    Alert.alert('Delete this news?', `"${item.title}" disappears for every player.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteNews(db, item.id);
            if (editing?.id === item.id) resetForm();
            await load();
          } catch (e) {
            Alert.alert('Not deleted', e?.message || 'Try again.');
          }
        },
      },
    ]);
  };

  const field = [styles.input, { backgroundColor: C.fieldBg, color: C.text, borderColor: C.border }];

  const composer = (
    <View style={[styles.card, { backgroundColor: C.surface, borderColor: editing ? accent : C.border }]}>
      <View style={styles.composerHead}>
        <Text style={[styles.composerTitle, { color: C.text }]}>{editing ? 'Edit news' : 'New news'}</Text>
        {editing ? (
          <TouchableOpacity onPress={resetForm} hitSlop={8}>
            <Text style={{ color: C.textMuted, fontWeight: '600' }}>Cancel edit</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      <TextInput
        value={title}
        onChangeText={setTitle}
        placeholder="Heading"
        placeholderTextColor={C.textFaint}
        maxLength={NEWS_TITLE_MAX}
        style={[field, styles.titleInput]}
      />
      <TextInput
        value={body}
        onChangeText={setBody}
        placeholder="Text"
        placeholderTextColor={C.textFaint}
        maxLength={NEWS_BODY_MAX}
        multiline
        textAlignVertical="top"
        style={[field, styles.bodyInput]}
      />
      <View style={styles.composerFoot}>
        <Text style={{ color: C.textFaint, fontSize: 11 }}>
          {title.length}/{NEWS_TITLE_MAX} · {body.length}/{NEWS_BODY_MAX}
        </Text>
        <TouchableOpacity
          onPress={confirmSave}
          disabled={!canSave}
          style={[styles.postBtn, { backgroundColor: accent, opacity: canSave ? 1 : 0.4 }]}
        >
          {saving ? <ActivityIndicator size="small" color="#FFF" /> : (
            <>
              <Ionicons name={editing ? 'checkmark' : 'paper-plane'} size={15} color="#FFF" />
              <Text style={styles.postText}>{editing ? 'Save' : 'Post'}</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <FlatList
      ref={listRef}
      data={items || []}
      keyExtractor={(item) => item.id}
      removeClippedSubviews={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: bottomInset + 24 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={accent} />}
      ListHeaderComponent={
        <>
          {composer}
          <Text style={[styles.section, { color: C.textMuted }]}>
            {items ? `Live on More ▸ News (${items.length})` : 'Live on More ▸ News'}
          </Text>
        </>
      }
      ListEmptyComponent={
        items === null
          ? <ActivityIndicator color={accent} style={{ marginTop: 24 }} />
          : <Text style={{ color: C.textFaint, textAlign: 'center', marginTop: 24 }}>No news yet. Players see "Nothing new… yet".</Text>
      }
      renderItem={({ item }) => {
        const edited = item.createdAt && item.updatedAt && item.updatedAt - item.createdAt > 60000;
        return (
          <View style={[styles.card, { backgroundColor: C.surface, borderColor: editing?.id === item.id ? accent : C.border }]}>
            <Text style={{ color: C.textFaint, fontSize: 11, fontWeight: '600' }}>
              {fmtDate(item.updatedAt)}{edited ? ' · edited' : ''}
            </Text>
            <Text style={[styles.itemTitle, { color: C.text }]}>{item.title}</Text>
            <Text style={{ color: C.textMuted, fontSize: 13, lineHeight: 18 }} numberOfLines={3}>{item.body}</Text>
            <View style={styles.itemActions}>
              <TouchableOpacity onPress={() => startEdit(item)} style={[styles.smallBtn, { borderColor: C.border }]}>
                <Ionicons name="create-outline" size={15} color={C.text} />
                <Text style={[styles.smallBtnText, { color: C.text }]}>Edit</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => confirmDelete(item)} style={[styles.smallBtn, { borderColor: `${danger}55` }]}>
                <Ionicons name="trash-outline" size={15} color={danger} />
                <Text style={[styles.smallBtnText, { color: danger }]}>Delete</Text>
              </TouchableOpacity>
            </View>
          </View>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 14, padding: 14, marginBottom: 10 },
  composerHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  composerTitle: { fontSize: 15, fontWeight: '800' },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, fontSize: 14.5 },
  titleInput: { height: 44, fontWeight: '700' },
  bodyInput: { minHeight: 110, maxHeight: 240, paddingTop: 10, paddingBottom: 10, marginTop: 8, lineHeight: 20 },
  composerFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },
  postBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 38, paddingHorizontal: 18, borderRadius: 19, minWidth: 90, justifyContent: 'center' },
  postText: { color: '#FFF', fontWeight: '800', fontSize: 14 },
  section: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 6, marginBottom: 8 },
  itemTitle: { fontSize: 15, fontWeight: '800', marginTop: 4, marginBottom: 4 },
  itemActions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  smallBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderRadius: 16, paddingHorizontal: 12, height: 32 },
  smallBtnText: { fontSize: 13, fontWeight: '700' },
});
