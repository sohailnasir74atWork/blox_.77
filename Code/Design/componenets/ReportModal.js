import React, { useState } from 'react';
import {
  Modal, View, Text, TextInput, TouchableOpacity, StyleSheet,
  Keyboard, TouchableWithoutFeedback,
} from 'react-native';
import { showMessage } from 'react-native-flash-message';
import { doc, collection, runTransaction } from '@react-native-firebase/firestore';
import { useLocalState } from '../../LocalGlobelStats';
import { useGlobalState, modGateText } from '../../GlobelStats';
import { submitUserReport } from '../../Helper/userReports';

const ReportModal = ({ visible, onClose, item }) => {
  const [reportText, setReportText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { updateLocalState, localState } = useLocalState()
  const { user, firestoreDB, getModGate } = useGlobalState();

  // const handleBanToggle = async () => {
  //   const action = isBlock ? t("chat.unblock") : t("chat.block");

  //   Alert.alert(
  //     `${action}`,
  //     `${t("chat.are_you_sure")} ${action.toLowerCase()} ${userName}?`,
  //     [
  //       { text: t("chat.cancel"), style: 'cancel' },
  //       {
  //         text: action,
  //         style: 'destructive',
  //         onPress: async () => {
  //           try {
  //             let updatedBannedUsers;

  //             if (isBlock) {
  //               // ✅ Remove from bannedUsers (Unban)
  //               updatedBannedUsers = bannedUsers.filter(id => id !== selectedUser?.senderId);
  //             } else {
  //               // ✅ Add to bannedUsers (Ban)
  //               updatedBannedUsers = [...bannedUsers, selectedUser?.senderId];
  //             }

  //             // ✅ Update local storage & state
  //             await updateLocalState('bannedUsers', updatedBannedUsers);

  //             // ✅ Wait a bit before showing the confirmation (Fix MMKV Delay)
  //             setTimeout(() => {
  //               showSuccessMessage(
  //                 t("home.alert.success"),
  //                 isBlock ? `${userName} ${t("chat.user_unblocked")}` : `${userName} ${t("chat.user_blocked")}`
  //               );
  //             }, 100); // Small delay to ensure UI updates correctly
  //           } catch (error) {
  //             console.error('❌ Error toggling ban status:', error);
  //           }
  //         },
  //       },
  //     ]
  //   );
  // };

  const REPORT_THRESHOLD = 10; // run ban when count >= 10

  const handleSubmit = async () => {
    if (submitting) return;

    if (!item || !item.id) {
      showMessage({ message: 'Invalid post.', type: 'danger' });
      return;
    }
    if (!reportText.trim()) {
      showMessage({ message: 'Please enter a reason.', type: 'warning' });
      return;
    }
    if (!user?.id) {
      showMessage({ message: 'Please sign in to report a post.', type: 'warning' });
      return;
    }
    // Banned users can't file reports (admins exempt; a mute is chat-only).
    const modGate = getModGate('content');
    if (modGate) {
      const { title, message } = modGateText(modGate, 'report');
      showMessage({ message: title, description: message, type: 'danger', duration: 5000 });
      return;
    }

    setSubmitting(true);
    const postRef = doc(firestoreDB, 'designPosts_upgrade', item.id);

    try {
      // PURE transaction: only Firestore reads/writes, no awaits to external code
      const txResult = await runTransaction(firestoreDB, async (tx) => {
        const snap = await tx.get(postRef);
        if (!snap.exists()) {
          return { status: 'missing' };
        }

        const currentCount = snap.get('reportCount') || 0;
        const nextCount = currentCount + 1;

        // Keep legacy boolean 'report' if your UI needs it
        const updates = {
          reportCount: nextCount,
          report: true,
        };

        // prevent double-ban by storing a flag
        const alreadyBanned = !!snap.get('banned');
        const shouldBan = !alreadyBanned && nextCount >= REPORT_THRESHOLD;

        if (shouldBan) {
          updates.banned = true; // mark so future transactions don't re-ban
        }

        tx.update(postRef, updates);

        return {
          status: 'ok',
          shouldBan,
          email: snap.get('email') || null,
          userId: snap.get('userId') || null,
        };
      });

      if (txResult.status === 'missing') {
        showMessage({ message: 'Post not found.', type: 'danger' });
        return;
      }

      // Auto-ban on report threshold was removed — bans are now manual
      // (admin/mod only). The transaction still flips `banned: true` on the
      // post so the feed hides it; only the user-account ban is gone.

      // Send the report (with the reporter's text) to user_reports so staff
      // see it in the Admin Dashboard. Best-effort: the count above already
      // landed, and the post is hidden for this user either way.
      try {
        await submitUserReport(firestoreDB, {
          type: 'post',
          targetId: item.id,
          targetUid: txResult.userId || item.userId || null,
          reporterUid: user.id,
          reason: reportText,
          text: reportText,
        });
      } catch (reportErr) {
        console.warn('user_reports write failed:', reportErr?.message || reportErr);
      }

      // local state/UI updates
      await updateLocalState('bannedUsers', [...(localState.bannedUsers || []), item.userId]);
      setReportText('');
      onClose();
    } catch (e) {
      console.error('Report submit error:', e);
      showMessage({ message: 'Could not submit report. Please try again.', type: 'danger' });
    } finally {
      setSubmitting(false);
    }
  };


  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <View style={styles.overlay}>
          <View style={styles.modal}>
            <Text style={styles.title}>Report Post</Text>
            <TextInput
              style={styles.input}
              placeholder="Why are you reporting this post?"
              placeholderTextColor="#888"
              value={reportText}
              onChangeText={setReportText}
              editable={!submitting}
              multiline
              maxLength={250}
            />
            <Text style={styles.charCount}>{reportText.length}/250</Text>
            <View className="buttonsRow" style={styles.buttonsRow}>
              <TouchableOpacity
                onPress={handleSubmit}
                style={[styles.submitButton, submitting && { opacity: 0.8 }]}
                disabled={submitting}
              >
                <Text style={styles.buttonText}>{submitting ? 'Submitting…' : 'Submit'}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={onClose} style={styles.cancelButton} disabled={submitting}>
                <Text style={styles.buttonText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: '#000000aa', justifyContent: 'center', alignItems: 'center' },
  modal: { backgroundColor: '#fff', width: '85%', padding: 20, borderRadius: 12, elevation: 6 },
  title: { fontSize: 18, fontWeight: '700', marginBottom: 10, color: '#333' },
  input: { borderWidth: 1, borderColor: '#ccc', padding: 12, borderRadius: 8, height: 100, textAlignVertical: 'top', fontSize: 14, color: '#000' },
  charCount: { alignSelf: 'flex-end', fontSize: 12, color: '#999', marginTop: 4 },
  buttonsRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 15 },
  submitButton: { backgroundColor: '#FF3B30', paddingVertical: 10, paddingHorizontal: 20, borderRadius: 8, flex: 1, marginRight: 5 },
  cancelButton: { backgroundColor: '#aaa', paddingVertical: 10, paddingHorizontal: 20, borderRadius: 8, flex: 1, marginLeft: 5 },
  buttonText: { color: '#fff', textAlign: 'center', fontWeight: '600' },
});

export default ReportModal;
