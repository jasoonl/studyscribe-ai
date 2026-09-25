// Builds the landing-page demo video from screenshots.
//   swiftc -O scripts/make-demo-video.swift -o /tmp/make-demo-video
//   /tmp/make-demo-video slides.json client/public/demo/studyscribe-demo.mp4
// slides.json: [{"image": "/abs/path.jpg", "title": "...", "caption": "..."}, ...]
import AVFoundation
import AppKit
import CoreGraphics

struct Slide: Decodable { let image: String; let title: String; let caption: String }

let W = 1600, H = 1080, BAND = 124, FPS: Int32 = 30
let SECONDS_PER_SLIDE = 4.5, FADE_SECONDS = 0.5

func fail(_ message: String) -> Never {
    FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
    exit(1)
}

guard CommandLine.arguments.count == 3 else { fail("usage: make-demo-video slides.json out.mp4") }
let slides: [Slide]
do {
    slides = try JSONDecoder().decode([Slide].self, from: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1])))
} catch { fail("could not read slides.json: \(error)") }
if slides.isEmpty { fail("no slides") }

let colorSpace = CGColorSpaceCreateDeviceRGB()

func render(_ slide: Slide) -> CGImage {
    guard let source = NSImage(contentsOfFile: slide.image), let cg = source.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
        fail("could not load \(slide.image)")
    }
    let ctx = CGContext(data: nil, width: W, height: H, bitsPerComponent: 8, bytesPerRow: 0, space: colorSpace,
                        bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue)!
    // Page background matches the app's off-white so short screenshots blend in.
    ctx.setFillColor(CGColor(red: 0.969, green: 0.965, blue: 0.965, alpha: 1))
    ctx.fill(CGRect(x: 0, y: 0, width: W, height: H))

    let area = CGRect(x: 0, y: BAND, width: W, height: H - BAND)
    let scale = min(area.width / CGFloat(cg.width), area.height / CGFloat(cg.height))
    let w = CGFloat(cg.width) * scale, h = CGFloat(cg.height) * scale
    ctx.interpolationQuality = .high
    ctx.draw(cg, in: CGRect(x: (area.width - w) / 2, y: area.maxY - h, width: w, height: h))

    // Caption band: white, indigo title, muted caption.
    ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
    ctx.fill(CGRect(x: 0, y: 0, width: W, height: BAND))
    ctx.setFillColor(CGColor(red: 0.90, green: 0.90, blue: 0.92, alpha: 1))
    ctx.fill(CGRect(x: 0, y: BAND - 1, width: W, height: 1))

    let title = NSAttributedString(string: slide.title, attributes: [
        .font: NSFont.systemFont(ofSize: 34, weight: .bold),
        .foregroundColor: NSColor(red: 0.18, green: 0.11, blue: 0.62, alpha: 1),
    ])
    let caption = NSAttributedString(string: slide.caption, attributes: [
        .font: NSFont.systemFont(ofSize: 22, weight: .regular),
        .foregroundColor: NSColor(red: 0.35, green: 0.35, blue: 0.38, alpha: 1),
    ])
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(cgContext: ctx, flipped: false)
    title.draw(at: NSPoint(x: 48, y: 66))
    caption.draw(with: NSRect(x: 48, y: 14, width: CGFloat(W) - 96, height: 44), options: [.usesLineFragmentOrigin, .truncatesLastVisibleLine])
    NSGraphicsContext.restoreGraphicsState()
    return ctx.makeImage()!
}

let frames = slides.map(render)

try? FileManager.default.removeItem(atPath: CommandLine.arguments[2])
let writer = try AVAssetWriter(outputURL: URL(fileURLWithPath: CommandLine.arguments[2]), fileType: .mp4)
let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
    AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: W, AVVideoHeightKey: H,
    AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: 900_000, AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel],
])
let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [
    kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA, kCVPixelBufferWidthKey as String: W, kCVPixelBufferHeightKey as String: H,
])
writer.shouldOptimizeForNetworkUse = true // moov atom first, so browsers can start playing before the whole file arrives
writer.add(input)
guard writer.startWriting() else { fail("cannot start writing: \(String(describing: writer.error))") }
writer.startSession(atSourceTime: .zero)

func buffer(from image: CGImage, over base: CGImage?, alpha: CGFloat) -> CVPixelBuffer {
    var pb: CVPixelBuffer?
    CVPixelBufferCreate(nil, W, H, kCVPixelFormatType_32BGRA, nil, &pb)
    let buf = pb!
    CVPixelBufferLockBaseAddress(buf, [])
    let ctx = CGContext(data: CVPixelBufferGetBaseAddress(buf), width: W, height: H, bitsPerComponent: 8,
                        bytesPerRow: CVPixelBufferGetBytesPerRow(buf), space: colorSpace,
                        bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue)!
    let rect = CGRect(x: 0, y: 0, width: W, height: H)
    if let base = base { ctx.draw(base, in: rect); ctx.setAlpha(alpha) }
    ctx.draw(image, in: rect)
    CVPixelBufferUnlockBaseAddress(buf, [])
    return buf
}

let holdFrames = Int(SECONDS_PER_SLIDE * Double(FPS)), fadeFrames = Int(FADE_SECONDS * Double(FPS))
var frameIndex: Int64 = 0
func append(_ pb: CVPixelBuffer) {
    while !input.isReadyForMoreMediaData { Thread.sleep(forTimeInterval: 0.005) }
    adaptor.append(pb, withPresentationTime: CMTime(value: frameIndex, timescale: FPS))
    frameIndex += 1
}

for (i, frame) in frames.enumerated() {
    if i > 0 {
        for f in 0..<fadeFrames { append(buffer(from: frame, over: frames[i - 1], alpha: CGFloat(f + 1) / CGFloat(fadeFrames + 1))) }
    }
    let still = buffer(from: frame, over: nil, alpha: 1)
    for _ in 0..<holdFrames { append(still) }
}

input.markAsFinished()
let done = DispatchSemaphore(value: 0)
writer.finishWriting { done.signal() }
done.wait()
if writer.status != .completed { fail("encode failed: \(String(describing: writer.error))") }
print("wrote \(CommandLine.arguments[2]): \(slides.count) slides, \(Double(frameIndex) / Double(FPS))s")
