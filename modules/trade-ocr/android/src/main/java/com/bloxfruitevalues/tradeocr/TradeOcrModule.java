package com.bloxfruitevalues.tradeocr;

import android.graphics.Rect;
import android.net.Uri;

import androidx.annotation.NonNull;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableArray;
import com.facebook.react.bridge.WritableMap;
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
}
