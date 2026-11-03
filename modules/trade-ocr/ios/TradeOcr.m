// Trade Scanner text reader (2026-11-01): Apple Vision, on the device. Same
// result shape as the Android ML Kit module:
// { width, height, lines: [{ text, x, y, w, h }] } in image pixels, top-left origin.
#import <React/RCTBridgeModule.h>
#import <UIKit/UIKit.h>
#import <Vision/Vision.h>
#import <TensorFlowLiteC/TensorFlowLiteC.h>

// Slot recogniser (2026-11-03): the same downloaded .tflite as Android
// (TradeOcrModule.java classifyTiles), run with TensorFlow Lite. Input one
// 128x128 RGB slot picture, float 0..255; output one cosine score per item.
enum { kSize = 128, kTop = 5 };

@interface TradeOcr : NSObject <RCTBridgeModule>
@end

@implementation TradeOcr {
  dispatch_queue_t _worker;
  TfLiteModel *_model;
  TfLiteInterpreter *_interpreter;
  NSString *_modelPath;
  NSMutableString *_tfliteError;
}

RCT_EXPORT_MODULE();

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

RCT_EXPORT_METHOD(recognize:(NSString *)uri
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    NSString *path = [uri hasPrefix:@"file://"] ? [NSURL URLWithString:uri].path : uri;
    UIImage *image = [UIImage imageWithContentsOfFile:path];
    CGImageRef cg = image.CGImage;
    if (!cg) {
      reject(@"ocr_read", @"Could not read the image", nil);
      return;
    }
    size_t w = CGImageGetWidth(cg);
    size_t h = CGImageGetHeight(cg);
    VNRecognizeTextRequest *request = [[VNRecognizeTextRequest alloc] init];
    request.recognitionLevel = VNRequestTextRecognitionLevelAccurate;
    request.usesLanguageCorrection = NO;
    VNImageRequestHandler *handler = [[VNImageRequestHandler alloc] initWithCGImage:cg options:@{}];
    NSError *error = nil;
    if (![handler performRequests:@[request] error:&error]) {
      reject(@"ocr_failed", error.localizedDescription ?: @"Vision failed", error);
      return;
    }
    NSMutableArray *lines = [NSMutableArray array];
    for (VNRecognizedTextObservation *obs in request.results) {
      VNRecognizedText *top = [[obs topCandidates:1] firstObject];
      if (!top) continue;
      CGRect b = obs.boundingBox; // normalised, bottom-left origin
      [lines addObject:@{
        @"text": top.string,
        @"x": @(b.origin.x * w),
        @"y": @((1.0 - b.origin.y - b.size.height) * h),
        @"w": @(b.size.width * w),
        @"h": @(b.size.height * h),
      }];
    }
    resolve(@{ @"width": @(w), @"height": @(h), @"lines": lines });
  });
}

- (instancetype)init
{
  if ((self = [super init])) {
    _worker = dispatch_queue_create("tradeocr.classify", DISPATCH_QUEUE_SERIAL);
    _tfliteError = [NSMutableString string];
  }
  return self;
}

- (void)dealloc
{
  [self closeModel];
}

- (void)closeModel
{
  if (_interpreter) TfLiteInterpreterDelete(_interpreter);
  if (_model) TfLiteModelDelete(_model);
  _interpreter = NULL;
  _model = NULL;
  _modelPath = nil;
}

// TensorFlow Lite's own message for the last failure, sent back with the
// rejection (and so into the scan report).
static void ReportTfLiteError(void *user, const char *format, va_list args)
{
  NSMutableString *sink = (__bridge NSMutableString *)user;
  [sink setString:[[NSString alloc] initWithFormat:@(format) arguments:args]];
}

// The model file the app downloaded from the CDN (scannerUpdate.js, checked
// by sha256). No model ships in the app.
- (TfLiteInterpreter *)interpreterFor:(NSString *)path error:(NSString **)error
{
  if (path.length == 0) { *error = @"no model downloaded"; return NULL; }
  if (_interpreter && [path isEqualToString:_modelPath]) return _interpreter;
  [self closeModel];
  _model = TfLiteModelCreateFromFile(path.fileSystemRepresentation);
  if (!_model) { *error = @"model unreadable"; return NULL; }
  TfLiteInterpreterOptions *options = TfLiteInterpreterOptionsCreate();
  TfLiteInterpreterOptionsSetNumThreads(options, 2);
  TfLiteInterpreterOptionsSetErrorReporter(options, ReportTfLiteError, (__bridge void *)_tfliteError);
  _interpreter = TfLiteInterpreterCreate(_model, options);
  TfLiteInterpreterOptionsDelete(options);
  if (!_interpreter || TfLiteInterpreterAllocateTensors(_interpreter) != kTfLiteOk) {
    [self closeModel];
    *error = [NSString stringWithFormat:@"model failed to load: %@", _tfliteError];
    return NULL;
  }
  _modelPath = path;
  return _interpreter;
}

// The picture the way it is shown (EXIF rotation applied), as Android does.
static CGImageRef UprightImage(UIImage *image)
{
  if (image.imageOrientation == UIImageOrientationUp) return CGImageRetain(image.CGImage);
  UIGraphicsImageRendererFormat *format = [UIGraphicsImageRendererFormat preferredFormat];
  format.scale = 1;
  UIGraphicsImageRenderer *renderer = [[UIGraphicsImageRenderer alloc] initWithSize:image.size format:format];
  UIImage *drawn = [renderer imageWithActions:^(UIGraphicsImageRendererContext *ctx) {
    [image drawInRect:CGRectMake(0, 0, image.size.width, image.size.height)];
  }];
  return CGImageRetain(drawn.CGImage);
}

static NSArray *TopScores(const float *scores, int count)
{
  int best[kTop];
  for (int r = 0; r < kTop; r++) best[r] = -1;
  for (int i = 0; i < count; i++) {
    for (int r = 0; r < kTop; r++) {
      if (best[r] < 0 || scores[i] > scores[best[r]]) {
        memmove(&best[r + 1], &best[r], sizeof(int) * (kTop - r - 1));
        best[r] = i;
        break;
      }
    }
  }
  NSMutableArray *out = [NSMutableArray array];
  for (int r = 0; r < kTop; r++) {
    if (best[r] < 0) continue;
    [out addObject:@{ @"i": @(best[r]), @"s": @(scores[best[r]]) }];
  }
  return out;
}

static long Clamp(long v, long lo, long hi)
{
  return MAX(lo, MIN(hi, v));
}

RCT_EXPORT_METHOD(classifyTiles:(NSString *)uri
                  crop:(NSDictionary *)crop
                  boxes:(NSArray *)boxes
                  modelPath:(NSString *)modelPath
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  dispatch_async(_worker, ^{
    NSString *error = nil;
    TfLiteInterpreter *net = [self interpreterFor:modelPath error:&error];
    if (!net) {
      // Model missing or unreadable: the scanner falls back to its picture matcher.
      reject(@"classify_failed", error, nil);
      return;
    }
    TfLiteTensor *input = TfLiteInterpreterGetInputTensor(net, 0);
    const TfLiteTensor *output = TfLiteInterpreterGetOutputTensor(net, 0);
    size_t inBytes = (size_t)kSize * kSize * 3 * sizeof(float);
    if (TfLiteTensorByteSize(input) != inBytes || TfLiteTensorNumDims(output) != 2) {
      reject(@"classify_failed", @"model shape", nil);
      return;
    }
    int classes = TfLiteTensorDim(output, 1);

    NSString *path = [uri hasPrefix:@"file://"] ? [NSURL URLWithString:uri].path : uri;
    UIImage *image = [UIImage imageWithContentsOfFile:path];
    CGImageRef cg = image ? UprightImage(image) : NULL;
    if (!cg) {
      reject(@"classify_failed", @"Could not read the image", nil);
      return;
    }
    long W = (long)CGImageGetWidth(cg);
    long H = (long)CGImageGetHeight(cg);
    double ox = [crop[@"x"] doubleValue] * W;
    double oy = [crop[@"y"] doubleValue] * H;

    uint8_t *rgba = calloc(kSize * kSize * 4, 1);
    float *in = malloc(inBytes);
    float *scores = malloc(sizeof(float) * classes);
    CGColorSpaceRef rgb = CGColorSpaceCreateDeviceRGB();
    CGContextRef ctx = CGBitmapContextCreate(rgba, kSize, kSize, 8, kSize * 4, rgb,
                                             kCGImageAlphaNoneSkipLast | kCGBitmapByteOrder32Big);
    CGContextSetInterpolationQuality(ctx, kCGInterpolationMedium);
    NSMutableArray *all = [NSMutableArray array];
    NSString *step = nil; // the step that failed
    for (NSArray *b in boxes) {
      long x0 = Clamp(lround(ox + [b[0] doubleValue]), 0, W - 2);
      long y0 = Clamp(lround(oy + [b[1] doubleValue]), 0, H - 2);
      long x1 = Clamp(lround(ox + [b[2] doubleValue]), x0 + 1, W);
      long y1 = Clamp(lround(oy + [b[3] doubleValue]), y0 + 1, H);
      CGImageRef tile = CGImageCreateWithImageInRect(cg, CGRectMake(x0, y0, x1 - x0, y1 - y0));
      CGContextDrawImage(ctx, CGRectMake(0, 0, kSize, kSize), tile);
      CGImageRelease(tile);
      for (int p = 0; p < kSize * kSize; p++) {
        in[p * 3] = rgba[p * 4];
        in[p * 3 + 1] = rgba[p * 4 + 1];
        in[p * 3 + 2] = rgba[p * 4 + 2];
      }
      [self->_tfliteError setString:@""];
      if (TfLiteTensorCopyFromBuffer(input, in, inBytes) != kTfLiteOk) { step = @"input"; break; }
      if (TfLiteInterpreterInvoke(net) != kTfLiteOk) { step = @"run"; break; }
      if (TfLiteTensorCopyToBuffer(output, scores, sizeof(float) * classes) != kTfLiteOk) { step = @"output"; break; }
      [all addObject:TopScores(scores, classes)];
    }
    CGContextRelease(ctx);
    CGColorSpaceRelease(rgb);
    CGImageRelease(cg);
    free(rgba);
    free(in);
    free(scores);
    if (step) {
      NSString *msg = [NSString stringWithFormat:@"model %@ failed: %@", step, self->_tfliteError];
      reject(@"classify_failed", msg, nil);
      return;
    }
    resolve(@{ @"classes": @(classes), @"tiles": all });
  });
}

@end
