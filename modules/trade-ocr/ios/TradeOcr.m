// Trade Scanner text reader (2026-11-01): Apple Vision, on the device, no
// extra SDK. Same result shape as the Android ML Kit module:
// { width, height, lines: [{ text, x, y, w, h }] } in image pixels, top-left origin.
#import <React/RCTBridgeModule.h>
#import <UIKit/UIKit.h>
#import <Vision/Vision.h>

@interface TradeOcr : NSObject <RCTBridgeModule>
@end

@implementation TradeOcr

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

@end
