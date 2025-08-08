import { Platform, Alert } from 'react-native';
import RNFS from 'react-native-fs';
import { CameraRoll } from '@react-native-camera-roll/camera-roll';
import { PERMISSIONS, request, RESULTS } from 'react-native-permissions';
import { showMessage } from 'react-native-flash-message';

export const requestStoragePermission = async () => {
  if (Platform.OS === 'android') {
    if (Platform.Version >= 33) {
      return await request(PERMISSIONS.ANDROID.READ_MEDIA_IMAGES);
    } else if (Platform.Version >= 29) {
      return await request(PERMISSIONS.ANDROID.READ_EXTERNAL_STORAGE);
    } else {
      return await request(PERMISSIONS.ANDROID.WRITE_EXTERNAL_STORAGE);
    }
  } else {
    return await request(PERMISSIONS.IOS.PHOTO_LIBRARY_ADD_ONLY);
  }
};

export const downloadImage = async (url) => {
  try {
    const filename = url.split('/').pop();
    const path = `${RNFS.CachesDirectoryPath}/${filename}`;
    const granted = await requestStoragePermission();
    if (granted === RESULTS.GRANTED) {
      const res = await RNFS.downloadFile({ fromUrl: url, toFile: path }).promise;
      if (res.statusCode === 200) {
        await CameraRoll.save(path, { type: 'photo' });
        showMessage({
          message: '✅ Image Saved',
          type: "success",
          icon: "success"
        });
        // Alert.alert('✅ Image Saved');
      } else {
        throw new Error('Failed to download');
      }
    } else {
      // Alert.alert('❌ Permission Denied');
      showMessage({
        message: 'Permission Denied',
        type: "danger",
        icon: "danger"
      });
    }
  } catch (e) {
    showMessage({
      message: e.message,
      type: "danger",
      icon: "danger"
    });
  }
}; 