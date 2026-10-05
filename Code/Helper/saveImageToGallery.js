import { Platform, PermissionsAndroid } from 'react-native';
import RNFS from 'react-native-fs';
import { CameraRoll } from '@react-native-camera-roll/camera-roll';

// Android 10+ adds new photos through MediaStore without any permission;
// Android 9 and older still need legacy external-storage write access.
export async function canSaveToGallery() {
  if (Platform.OS !== 'android' || Platform.Version >= 29) return true;
  try {
    const res = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE);
    return res === PermissionsAndroid.RESULTS.GRANTED;
  } catch (e) {
    return false;
  }
}

// Downloads a remote image to the cache and copies it into the photo library.
// Throws on network or save failure; the temp file is always removed.
export async function saveImageToGallery(url) {
  const ext = (url.split('?')[0].match(/\.(jpe?g|png|webp|gif)$/i)?.[1] || 'jpg').toLowerCase();
  const dest = `${RNFS.CachesDirectoryPath}/save-${Date.now()}-${Math.floor(Math.random() * 1e6)}.${ext}`;
  try {
    const res = await RNFS.downloadFile({
      fromUrl: url,
      toFile: dest,
      connectionTimeout: 15000,
      readTimeout: 30000,
    }).promise;
    if (res.statusCode !== 200) throw new Error(`download failed: ${res.statusCode}`);
    await CameraRoll.save(Platform.OS === 'android' ? `file://${dest}` : dest, { type: 'photo' });
  } finally {
    RNFS.unlink(dest).catch(() => {});
  }
}

// Saves every image in order; resolves to how many made it into the gallery.
export async function saveImagesToGallery(urls) {
  let saved = 0;
  for (const url of urls) {
    try {
      await saveImageToGallery(url);
      saved += 1;
    } catch (e) {
      console.log('saveImageToGallery error:', e?.message);
    }
  }
  return saved;
}
