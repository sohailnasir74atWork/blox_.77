package com.bloxfruitevalues.tradeocr;

import android.content.ContentResolver;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Matrix;
import android.graphics.Rect;
import android.net.Uri;

import androidx.annotation.NonNull;
import androidx.exifinterface.media.ExifInterface;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.ReadableArray;
import com.facebook.react.bridge.ReadableMap;
import com.facebook.react.bridge.WritableArray;
import com.facebook.react.bridge.WritableMap;
import org.tensorflow.lite.InterpreterApi;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;

/**
 * Reads the text lines of a picked screenshot on the device (ML Kit, Latin
 * model from Play services). Nothing is uploaded. Used by the Trade Scanner
 * to read the fruit names printed on the trade window's slots.
 */
public class TradeOcrModule extends ReactContextBaseJavaModule {
  TradeOcrModule(ReactApplicationContext context) {
    super(context);
  }

  @NonNull
  @Override
  public String getName() {
    return "TradeOcr";
  }

  @ReactMethod
  public void recognize(String uri, Promise promise) {
    final InputImage image;
    try {
      image = InputImage.fromFilePath(getReactApplicationContext(), Uri.parse(uri));
    } catch (Exception e) {
      promise.reject("ocr_read", e.getMessage(), e);
      return;
    }
    final TextRecognizer recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);
    recognizer.process(image)
        .addOnSuccessListener(text -> {
          WritableArray lines = Arguments.createArray();
          for (Text.TextBlock block : text.getTextBlocks()) {
            for (Text.Line line : block.getLines()) {
              Rect b = line.getBoundingBox();
              if (b == null) continue;
              WritableMap m = Arguments.createMap();
              m.putString("text", line.getText());
              m.putDouble("x", b.left);
              m.putDouble("y", b.top);
              m.putDouble("w", b.width());
              m.putDouble("h", b.height());
              lines.pushMap(m);
            }
          }
          WritableMap out = Arguments.createMap();
          out.putInt("width", image.getWidth());
          out.putInt("height", image.getHeight());
          out.putArray("lines", lines);
          recognizer.close();
          promise.resolve(out);
        })
        .addOnFailureListener(e -> {
          recognizer.close();
          // UNAVAILABLE while Play services is still downloading the model.
          promise.reject("ocr_failed", e.getMessage(), e);
        });
  }

  // ── Slot recogniser (2026-11-03, same engine as the Adopt Me app) ──
  // assets/trade_tiles.tflite: MobileNetV3 trained on every catalogue fruit as
  // generated slots, fake phone photos and real trade thumbnails
  // (RunningApps/_scanner_ml/blox). Input one 128x128 RGB slot picture,
  // 0..255; output one cosine score per item, in the order of
  // Code/TradeScanner/tileModelNames.json.
  private static final int SIZE = 128;
  private static final int TOP = 5;
  private final ExecutorService worker = Executors.newSingleThreadExecutor();
  private InterpreterApi interpreter;
  // "" = the bundled assets/trade_tiles.tflite; otherwise a model file the
  // app downloaded from the CDN (scannerUpdate.js, checked by sha256).
  private String interpreterPath;

  private synchronized InterpreterApi model(String path) throws Exception {
    String key = path == null ? "" : path;
    if (interpreter != null && key.equals(interpreterPath)) return interpreter;
    if (interpreter != null) { interpreter.close(); interpreter = null; }
    ByteBuffer file;
    try (InputStream in = key.isEmpty()
        ? getReactApplicationContext().getAssets().open("trade_tiles.tflite")
        : new java.io.FileInputStream(key)) {
      ByteArrayOutputStream out = new ByteArrayOutputStream();
      byte[] chunk = new byte[1 << 16];
      for (int n; (n = in.read(chunk)) > 0; ) out.write(chunk, 0, n);
      byte[] bytes = out.toByteArray();
      file = ByteBuffer.allocateDirect(bytes.length).order(ByteOrder.nativeOrder());
      file.put(bytes).rewind();
    }
    interpreter = InterpreterApi.create(file,
        new InterpreterApi.Options().setRuntime(InterpreterApi.Options.TfLiteRuntime.FROM_APPLICATION_ONLY).setNumThreads(2));
    interpreterPath = key;
    return interpreter;
  }

  private Bitmap decode(Uri uri) throws Exception {
    ContentResolver cr = getReactApplicationContext().getContentResolver();
    Bitmap bmp;
    try (InputStream in = cr.openInputStream(uri)) {
      bmp = BitmapFactory.decodeStream(in);
    }
    if (bmp == null) throw new IllegalStateException("decode");
    int deg = 0;
    try (InputStream in = cr.openInputStream(uri)) {
      int o = new ExifInterface(in).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL);
      deg = o == ExifInterface.ORIENTATION_ROTATE_90 ? 90 : o == ExifInterface.ORIENTATION_ROTATE_180 ? 180 : o == ExifInterface.ORIENTATION_ROTATE_270 ? 270 : 0;
    } catch (Exception ignored) {
      // No EXIF: as decoded.
    }
    if (deg == 0) return bmp;
    Matrix m = new Matrix();
    m.postRotate(deg);
    return Bitmap.createBitmap(bmp, 0, 0, bmp.getWidth(), bmp.getHeight(), m, true);
  }

  /**
   * uri: the picked picture. crop: the CropBox frame {x, y, w, h} as shares of
   * the picture. boxes: [[x0, y0, x1, y1]] in the frame's pixels (what the
   * WebView matcher returns). modelPath: a downloaded model file, or null for
   * the bundled one. Resolves { classes: item count of the model, tiles: one
   * array per box of the best items [{ i: item index, s: score 0..1 }] }.
   */
  @ReactMethod
  public void classifyTiles(String uri, ReadableMap crop, ReadableArray boxes, String modelPath, Promise promise) {
    worker.execute(() -> {
      try {
        InterpreterApi net = model(modelPath);
        int classes = net.getOutputTensor(0).shape()[1];
        Bitmap bmp = decode(Uri.parse(uri));
        double ox = crop.getDouble("x") * bmp.getWidth();
        double oy = crop.getDouble("y") * bmp.getHeight();
        ByteBuffer input = ByteBuffer.allocateDirect(SIZE * SIZE * 3 * 4).order(ByteOrder.nativeOrder());
        float[][] output = new float[1][classes];
        int[] px = new int[SIZE * SIZE];
        WritableArray all = Arguments.createArray();
        for (int k = 0; k < boxes.size(); k++) {
          ReadableArray b = boxes.getArray(k);
          int x0 = clamp((int) Math.round(ox + b.getDouble(0)), 0, bmp.getWidth() - 2);
          int y0 = clamp((int) Math.round(oy + b.getDouble(1)), 0, bmp.getHeight() - 2);
          int x1 = clamp((int) Math.round(ox + b.getDouble(2)), x0 + 1, bmp.getWidth());
          int y1 = clamp((int) Math.round(oy + b.getDouble(3)), y0 + 1, bmp.getHeight());
          Bitmap tile = Bitmap.createScaledBitmap(Bitmap.createBitmap(bmp, x0, y0, x1 - x0, y1 - y0), SIZE, SIZE, true);
          tile.getPixels(px, 0, SIZE, 0, 0, SIZE, SIZE);
          input.rewind();
          for (int p : px) {
            input.putFloat((p >> 16) & 0xFF);
            input.putFloat((p >> 8) & 0xFF);
            input.putFloat(p & 0xFF);
          }
          input.rewind();
          net.run(input, output);
          all.pushArray(top(output[0]));
        }
        WritableMap out = Arguments.createMap();
        out.putInt("classes", classes);
        out.putArray("tiles", all);
        promise.resolve(out);
      } catch (Throwable e) {
        // Model missing, unreadable picture: the scanner falls back to its
        // picture matcher.
        android.util.Log.w("TradeOcr", "classifyTiles failed", e);
        promise.reject("classify_failed", String.valueOf(e.getMessage()), e);
      }
    });
  }

  private static int clamp(int v, int lo, int hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  private static WritableArray top(float[] scores) {
    int[] best = new int[TOP];
    java.util.Arrays.fill(best, -1);
    for (int i = 0; i < scores.length; i++) {
      for (int r = 0; r < TOP; r++) {
        if (best[r] < 0 || scores[i] > scores[best[r]]) {
          System.arraycopy(best, r, best, r + 1, TOP - r - 1);
          best[r] = i;
          break;
        }
      }
    }
    WritableArray out = Arguments.createArray();
    for (int i : best) {
      if (i < 0) continue;
      WritableMap m = Arguments.createMap();
      m.putInt("i", i);
      m.putDouble("s", scores[i]);
      out.pushMap(m);
    }
    return out;
  }
}
