import React, { useState } from 'react';
import {
  Modal, View, Text, TextInput, TouchableOpacity, StyleSheet,
  Keyboard, TouchableWithoutFeedback,
} from 'react-native';
import { showMessage } from 'react-native-flash-message';
import firestore from '@react-native-firebase/firestore';
import { useLocalState } from '../../LocalGlobelStats';

const ReportModal = ({ visible, onClose, item }) => {
  const [reportText, setReportText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const {updateLocalState, localState} = useLocalState()
// console.log(localState.bannedUsers)

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

  const handleSubmit = async () => {
    if (submitting) return;
    if (!item?.id) {
      showMessage({ message: 'Invalid post.', type: 'danger' });
      return;
    }
    if (!reportText.trim()) {
      showMessage({ message: 'Please enter a reason.', type: 'warning' });
      return;
    }

    setSubmitting(true);
    const postRef = firestore().collection('designPosts').doc(item.id);

    try {
      // 1) Atomically check 'report' and update/delete
      const result = await firestore().runTransaction(async tx => {
        const snap = await tx.get(postRef);
        if (!snap.exists) throw new Error('Post not found');

        const alreadyReported = !!snap.get('report'); // your field from uploader
        if (!alreadyReported) {
          tx.update(postRef, {
            report: true
          });
          // return { action: 'flagged' };
        } else {
          tx.delete(postRef);
          // return { action: 'deleted' };
        }
      });

      await updateLocalState('bannedUsers', [...localState.bannedUsers, item.userId]);
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
                style={[styles.submitButton, submitting && { opacity: 0.6 }]}
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
