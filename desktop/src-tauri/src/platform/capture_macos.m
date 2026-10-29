#import <Foundation/Foundation.h>
#import <CoreGraphics/CoreGraphics.h>
#import <ScreenCaptureKit/ScreenCaptureKit.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

bool algorithshot_cursor_position(double *x, double *y) {
    CGEventRef event = CGEventCreate(NULL);
    if (!event) return false;
    CGPoint point = CGEventGetLocation(event);
    CFRelease(event);
    *x = point.x; *y = point.y;
    return true;
}

bool algorithshot_capture_permission(bool request) {
    return CGPreflightScreenCaptureAccess() || (request && CGRequestScreenCaptureAccess());
}

bool algorithshot_has_screenshot_manager(void) {
    if (@available(macOS 14.0, *)) return true;
    return false;
}

static bool capture_error(char *buffer, size_t size, NSString *message) {
    if (size) strlcpy(buffer, (message ?: @"Screen capture failed").UTF8String, size);
    return false;
}

bool algorithshot_capture_display(uint32_t displayID, unsigned char **pixels,
                                 uint32_t *width, uint32_t *height,
                                 char *error, size_t errorSize) {
    @autoreleasepool {
        *pixels = NULL;
        if (@available(macOS 14.0, *)) {
            dispatch_semaphore_t ready = dispatch_semaphore_create(0);
            __block SCShareableContent *content = nil;
            __block NSString *failure = nil;
            [SCShareableContent getShareableContentExcludingDesktopWindows:NO
                onScreenWindowsOnly:YES completionHandler:^(SCShareableContent *value, NSError *e) {
                    content = value;
                    failure = e.localizedDescription;
                    dispatch_semaphore_signal(ready);
                }];
            if (dispatch_semaphore_wait(ready, dispatch_time(DISPATCH_TIME_NOW, 15 * NSEC_PER_SEC)))
                return capture_error(error, errorSize, @"Timed out while finding displays. Please retry.");
            if (!content) return capture_error(error, errorSize, failure);
            SCDisplay *display = nil;
            for (SCDisplay *candidate in content.displays)
                if (candidate.displayID == displayID) { display = candidate; break; }
            if (!display) return capture_error(error, errorSize, @"The selected display is no longer available.");

            SCContentFilter *filter = [[SCContentFilter alloc] initWithDisplay:display excludingWindows:@[]];
            SCStreamConfiguration *configuration = [[SCStreamConfiguration alloc] init];
            configuration.width = CGDisplayPixelsWide(displayID);
            configuration.height = CGDisplayPixelsHigh(displayID);
            configuration.showsCursor = NO;
            dispatch_semaphore_t captured = dispatch_semaphore_create(0);
            // Strong ARC storage also releases a late result after a timeout.
            __block id retainedImage = nil;
            [SCScreenshotManager captureImageWithFilter:filter configuration:configuration
                completionHandler:^(CGImageRef image, NSError *e) {
                    retainedImage = (__bridge id)image;
                    failure = e.localizedDescription;
                    dispatch_semaphore_signal(captured);
                }];
            if (dispatch_semaphore_wait(captured, dispatch_time(DISPATCH_TIME_NOW, 15 * NSEC_PER_SEC)))
                return capture_error(error, errorSize, @"Screen capture timed out. Please retry.");
            CGImageRef image = (__bridge CGImageRef)retainedImage;
            if (!image) return capture_error(error, errorSize, failure);
            size_t w = CGImageGetWidth(image), h = CGImageGetHeight(image);
            if (!w || !h || w > UINT32_MAX || h > UINT32_MAX || h > SIZE_MAX / 4 || w > SIZE_MAX / (h * 4))
                return capture_error(error, errorSize, @"Screen capture returned an invalid image size.");
            unsigned char *data = calloc(h, w * 4);
            if (!data) return capture_error(error, errorSize, @"Not enough memory to capture this display.");
            CGColorSpaceRef color = CGColorSpaceCreateDeviceRGB();
            CGContextRef context = CGBitmapContextCreate(data, w, h, 8, w * 4, color,
                kCGImageAlphaPremultipliedLast | kCGBitmapByteOrder32Big);
            CGColorSpaceRelease(color);
            if (!context) {
                free(data);
                return capture_error(error, errorSize, @"Could not prepare the captured image.");
            }
            CGContextDrawImage(context, CGRectMake(0, 0, w, h), image);
            CGContextRelease(context);
            *pixels = data; *width = (uint32_t)w; *height = (uint32_t)h;
            return true;
        }
        return capture_error(error, errorSize, @"This capture method is unavailable on this macOS version.");
    }
}

void algorithshot_free_capture(void *pixels) { free(pixels); }
