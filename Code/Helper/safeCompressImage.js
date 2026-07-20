import { Image as CompressorImage } from 'react-native-compressor';
import RNFS from 'react-native-fs';

// react-native-compressor's iOS module raises an NSException (not a Promise rejection)
// when it can't load the input image — that crashes the app uncatchably. This helper
// preflights the URI so we don't hand the native side something it'll choke on, and
// always falls back to the original URI on any failure.
export async function safeCompressImage(uri, options = {}) {
  if (!uri || typeof uri !== 'string') {
    return { uri: uri || '', compressed: false, reason: 'empty-uri' };
  }

  if (uri.startsWith('file://')) {
    const path = uri.replace('file://', '');
    try {
      const stat = await RNFS.stat(path);
      if (!stat || Number(stat.size) <= 0) {
        return { uri, compressed: false, reason: 'empty-file' };
      }
    } catch {
      return { uri, compressed: false, reason: 'missing-file' };
    }
  } else if (!uri.startsWith('data:') && !uri.startsWith('http://') && !uri.startsWith('https://')) {
    // ph://, content://, or other schemes the iOS loader can't handle reliably.
    return { uri, compressed: false, reason: 'unsupported-scheme' };
  }

  try {
    const result = await CompressorImage.compress(uri, options);
    if (!result || typeof result !== 'string') {
      return { uri, compressed: false, reason: 'empty-result' };
    }
    return { uri: result, compressed: true };
  } catch (error) {
    console.warn('[safeCompressImage] compress failed, using original:', error?.message);
    return { uri, compressed: false, reason: 'compress-error' };
  }
}
