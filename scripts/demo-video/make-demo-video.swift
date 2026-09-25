// Renders the product demo video: an animated cursor clicks through screenshots of the app, with a
// camera that follows it, captions, the narration and music from build.py.
//   swiftc -O scripts/demo-video/make-demo-video.swift -o <workdir>/mkvideo
//   <workdir>/mkvideo <workdir>/timeline.json client/public/demo/studyscribe-demo.mp4
import AVFoundation
import AppKit
import CoreGraphics

struct Key: Decodable {
    var f: Double?
    var at: Double?
    var x: Double
    var y: Double
    var click: Bool?
    var select: [Double]?
}
struct Timeline: Decodable {
    var frames: String
    var audio: String
    var totalDuration: Double
    var scenes: [RawScene]
}
struct RawScene: Decodable {
    var image: String?
    var title: String
    var caption: String
    var zoom: Double?
    var endcard: Bool?
    var duration: Double
    var cursor: [Key]?
    var startTime: Double
    var origin: [Double]?
    enum CodingKeys: String, CodingKey { case image, title, caption, zoom, endcard, duration, cursor, start, origin }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        image = try c.decodeIfPresent(String.self, forKey: .image)
        title = try c.decode(String.self, forKey: .title)
        caption = try c.decode(String.self, forKey: .caption)
        zoom = try c.decodeIfPresent(Double.self, forKey: .zoom)
        endcard = try c.decodeIfPresent(Bool.self, forKey: .endcard)
        duration = try c.decode(Double.self, forKey: .duration)
        cursor = try c.decodeIfPresent([Key].self, forKey: .cursor)
        if let t = try? c.decode(Double.self, forKey: .start) { startTime = t } else { startTime = 0 }
        origin = try? c.decode([Double].self, forKey: .origin)
    }
}

let W = 1600, H = 1080, BAND = 124, AH = H - BAND, FPS = 30
let FW = CGFloat(W), FH = CGFloat(H), AHF = CGFloat(AH)

func fail(_ message: String) -> Never {
    FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
    exit(1)
}
guard CommandLine.arguments.count == 3 else { fail("usage: mkvideo timeline.json out.mp4") }
let outPath = CommandLine.arguments[2]
let timeline: Timeline
do { timeline = try JSONDecoder().decode(Timeline.self, from: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))) } catch { fail("bad timeline: \(error)") }
let scenes = timeline.scenes
let colorSpace = CGColorSpaceCreateDeviceRGB()
let bitmapInfo = CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue

// MARK: assets

func loadImage(_ name: String) -> CGImage {
    let path = timeline.frames + "/" + name
    guard let ns = NSImage(contentsOfFile: path), let cg = ns.cgImage(forProposedRect: nil, context: nil, hints: nil) else { fail("cannot load \(path)") }
    return cg
}

func bandImage(title: String, caption: String) -> CGImage {
    let ctx = CGContext(data: nil, width: W, height: BAND, bitsPerComponent: 8, bytesPerRow: 0, space: colorSpace, bitmapInfo: bitmapInfo)!
    ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1)); ctx.fill(CGRect(x: 0, y: 0, width: W, height: BAND))
    ctx.setFillColor(CGColor(red: 0.90, green: 0.90, blue: 0.92, alpha: 1)); ctx.fill(CGRect(x: 0, y: BAND - 1, width: W, height: 1))
    let t = NSAttributedString(string: title, attributes: [.font: NSFont.systemFont(ofSize: 34, weight: .bold), .foregroundColor: NSColor(red: 0.18, green: 0.11, blue: 0.62, alpha: 1)])
    let c = NSAttributedString(string: caption, attributes: [.font: NSFont.systemFont(ofSize: 22), .foregroundColor: NSColor(red: 0.35, green: 0.35, blue: 0.38, alpha: 1)])
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(cgContext: ctx, flipped: false)
    t.draw(at: NSPoint(x: 48, y: 66))
    c.draw(with: NSRect(x: 48, y: 14, width: CGFloat(W) - 96, height: 44), options: [.usesLineFragmentOrigin, .truncatesLastVisibleLine])
    NSGraphicsContext.restoreGraphicsState()
    return ctx.makeImage()!
}

func endCard(title: String, caption: String) -> CGImage {
    let ctx = CGContext(data: nil, width: W, height: H, bitsPerComponent: 8, bytesPerRow: 0, space: colorSpace, bitmapInfo: bitmapInfo)!
    let gradient = CGGradient(colorsSpace: colorSpace, colors: [CGColor(red: 0.13, green: 0.10, blue: 0.55, alpha: 1), CGColor(red: 0.02, green: 0.60, blue: 0.68, alpha: 1)] as CFArray, locations: [0, 1])!
    ctx.drawLinearGradient(gradient, start: CGPoint(x: 0, y: FH), end: CGPoint(x: FW, y: 0), options: [])
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(cgContext: ctx, flipped: false)
    func centered(_ s: String, size: CGFloat, weight: NSFont.Weight, y: CGFloat, alpha: CGFloat = 1) {
        let a = NSAttributedString(string: s, attributes: [.font: NSFont.systemFont(ofSize: size, weight: weight), .foregroundColor: NSColor(white: 1, alpha: alpha)])
        let w = a.size().width
        a.draw(at: NSPoint(x: (FW - w) / 2, y: y))
    }
    centered(title, size: 118, weight: .bold, y: 540)
    centered(caption, size: 50, weight: .regular, y: 460, alpha: 0.9)
    let pill = CGRect(x: (FW - 560) / 2, y: 330, width: 560, height: 76)
    ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 0.18))
    ctx.addPath(CGPath(roundedRect: pill, cornerWidth: 38, cornerHeight: 38, transform: nil)); ctx.fillPath()
    centered("studyscribe-ai.vercel.app", size: 34, weight: .semibold, y: 352)
    NSGraphicsContext.restoreGraphicsState()
    return ctx.makeImage()!
}

let images: [CGImage?] = scenes.map { $0.endcard == true ? nil : loadImage($0.image!) }
let bands: [CGImage] = scenes.map { bandImage(title: $0.title, caption: $0.caption) }
let endImage: CGImage? = scenes.first(where: { $0.endcard == true }).map { endCard(title: $0.title, caption: $0.caption) }

// MARK: cursor path

struct Waypoint { var t: Double; var p: CGPoint; var click: Bool; var select: CGRect? }

// Absolute waypoint time (seconds from timeline start) for a key.
func waypoints(for index: Int, from origin: CGPoint) -> [Waypoint] {
    let s = scenes[index]
    var result = [Waypoint(t: s.startTime, p: origin, click: false, select: nil)]
    for k in s.cursor ?? [] {
        let rel = k.at.map { $0 < 0 ? s.duration + $0 : $0 } ?? (k.f ?? 0) * s.duration
        var sel: CGRect? = nil
        if let r = k.select, r.count == 4 { sel = CGRect(x: r[0], y: r[1], width: r[2], height: r[3]) }
        result.append(Waypoint(t: s.startTime + rel, p: CGPoint(x: k.x, y: k.y), click: k.click ?? false, select: sel))
    }
    return result
}

func smooth(_ u: Double) -> Double { let c = min(1, max(0, u)); return c * c * (3 - 2 * c) }
func lerp(_ a: CGFloat, _ b: CGFloat, _ u: CGFloat) -> CGFloat { a + (b - a) * u }

// Precompute every scene's waypoints, chaining each scene's start position to the previous scene's end.
var allWaypoints: [[Waypoint]] = []
var origin = CGPoint(x: 1500, y: 620)
if let o = scenes.first?.origin, o.count == 2 { origin = CGPoint(x: o[0], y: o[1]) }
for i in scenes.indices {
    let w = waypoints(for: i, from: origin)
    allWaypoints.append(w)
    origin = w.last!.p
}

func cursorPosition(scene i: Int, at t: Double) -> CGPoint {
    let w = allWaypoints[i]
    if t <= w[0].t { return w[0].p }
    for j in 1..<w.count where t <= w[j].t {
        let a = w[j - 1], b = w[j]
        let u = smooth((t - a.t) / max(0.001, b.t - a.t))
        let dx = b.p.x - a.p.x, dy = b.p.y - a.p.y
        let dist = hypot(dx, dy)
        // A slight arc, so the path looks like a hand rather than a ruler.
        let bow = sin(u * .pi) * min(60, dist * 0.10)
        let nx = dist > 0 ? -dy / dist : 0, ny = dist > 0 ? dx / dist : 0
        return CGPoint(x: lerp(a.p.x, b.p.x, u) + nx * bow, y: lerp(a.p.y, b.p.y, u) + ny * bow)
    }
    return w.last!.p
}

// MARK: drawing

func drawArrow(_ ctx: CGContext, at p: CGPoint, scale: CGFloat) {
    let pts: [(CGFloat, CGFloat)] = [(0, 0), (0, 17), (4.2, 13.4), (7, 20), (10, 18.8), (7.2, 12.5), (12.6, 12.5)]
    let path = CGMutablePath()
    for (i, q) in pts.enumerated() {
        let pt = CGPoint(x: p.x + q.0 * scale, y: p.y + q.1 * scale)
        i == 0 ? path.move(to: pt) : path.addLine(to: pt)
    }
    path.closeSubpath()
    ctx.saveGState()
    ctx.setShadow(offset: CGSize(width: 0, height: -2), blur: 6, color: CGColor(gray: 0, alpha: 0.35))
    ctx.setFillColor(CGColor(gray: 1, alpha: 1)); ctx.addPath(path); ctx.fillPath()
    ctx.restoreGState()
    ctx.setStrokeColor(CGColor(gray: 0.05, alpha: 1)); ctx.setLineWidth(1.6 * scale / 1.5); ctx.setLineJoin(.round)
    ctx.addPath(path); ctx.strokePath()
}

// Camera state, smoothed frame to frame.
var camCenter = CGPoint(x: FW / 2, y: AHF / 2)
var camZoom: CGFloat = 1.0

func clampCenter(_ c: CGPoint, zoom z: CGFloat) -> CGPoint {
    let hx = FW / (2 * z), hy = AHF / (2 * z)
    return CGPoint(x: min(max(c.x, hx), FW - hx), y: min(max(c.y, hy), AHF - hy))
}

func sceneIndex(at t: Double) -> Int {
    var idx = 0
    for (i, s) in scenes.enumerated() where t >= s.startTime { idx = i }
    return idx
}

func render(frame n: Int, into ctx: CGContext, dt: CGFloat) {
    let t = Double(n) / Double(FPS)
    let cur = sceneIndex(at: t)
    let scene = scenes[cur]

    // Which screenshot is showing, and how far the cross-fade to the next one has got.
    // The switch is centred just before the next scene's start so a click lands, then the page changes.
    var top = cur, bottom = cur, mix: CGFloat = 0
    if cur + 1 < scenes.count {
        let boundary = scenes[cur + 1].startTime
        let u = (t - (boundary - 0.4)) / 0.3
        if u > 0 { bottom = cur + 1; mix = CGFloat(smooth(u)) }
    }

    // Everything is drawn top-left-origin.
    ctx.saveGState()
    ctx.translateBy(x: 0, y: FH); ctx.scaleBy(x: 1, y: -1)

    let cursor = scene.endcard == true ? CGPoint(x: FW / 2, y: AHF / 2) : cursorPosition(scene: cur, at: t)
    let targetZoom = CGFloat(scene.zoom ?? 1.0)
    let k = CGFloat(1 - exp(-Double(dt) * 2.4))
    camZoom += (targetZoom - camZoom) * k
    let want = clampCenter(scene.endcard == true ? CGPoint(x: FW / 2, y: AHF / 2) : cursor, zoom: camZoom)
    camCenter.x += (want.x - camCenter.x) * k
    camCenter.y += (want.y - camCenter.y) * k
    camCenter = clampCenter(camCenter, zoom: camZoom)

    ctx.setFillColor(CGColor(red: 0.969, green: 0.965, blue: 0.965, alpha: 1))
    ctx.fill(CGRect(x: 0, y: 0, width: FW, height: FH))

    func toScreen(_ p: CGPoint) -> CGPoint {
        CGPoint(x: (p.x - camCenter.x) * camZoom + FW / 2, y: (p.y - camCenter.y) * camZoom + AHF / 2)
    }

    // Screenshot layer(s), under the camera transform.
    ctx.saveGState()
    ctx.clip(to: CGRect(x: 0, y: 0, width: FW, height: AHF))
    ctx.translateBy(x: FW / 2, y: AHF / 2); ctx.scaleBy(x: camZoom, y: camZoom); ctx.translateBy(x: -camCenter.x, y: -camCenter.y)
    ctx.interpolationQuality = .high
    func drawPage(_ index: Int, alpha: CGFloat) {
        guard let img = images[index], alpha > 0 else { return }
        let h = CGFloat(img.height) * FW / CGFloat(img.width)
        ctx.saveGState()
        ctx.setAlpha(alpha)
        ctx.translateBy(x: 0, y: h); ctx.scaleBy(x: 1, y: -1)
        ctx.draw(img, in: CGRect(x: 0, y: 0, width: FW, height: h))
        ctx.restoreGState()
    }
    if scenes[top].endcard != true { drawPage(top, alpha: 1) }
    if bottom != top, scenes[bottom].endcard != true { drawPage(bottom, alpha: mix) }

    // Selected answers stay highlighted for the rest of the scene.
    if scene.endcard != true {
        for w in allWaypoints[cur] where w.click && w.select != nil && t >= w.t {
            let r = w.select!
            let path = CGPath(roundedRect: r, cornerWidth: 10, cornerHeight: 10, transform: nil)
            ctx.setFillColor(CGColor(red: 0.25, green: 0.30, blue: 0.95, alpha: 0.10)); ctx.addPath(path); ctx.fillPath()
            ctx.setStrokeColor(CGColor(red: 0.25, green: 0.30, blue: 0.95, alpha: 0.85)); ctx.setLineWidth(2.5); ctx.addPath(path); ctx.strokePath()
        }
    }
    ctx.restoreGState()

    // End card fades in over the last page.
    if let end = endImage, let idx = scenes.firstIndex(where: { $0.endcard == true }) {
        let u = CGFloat(smooth((t - (scenes[idx].startTime - 0.4)) / 0.9))
        if u > 0 {
            ctx.saveGState(); ctx.setAlpha(u)
            ctx.translateBy(x: 0, y: FH); ctx.scaleBy(x: 1, y: -1)
            ctx.draw(end, in: CGRect(x: 0, y: 0, width: FW, height: FH))
            ctx.restoreGState()
        }
    }

    // Click ripples and the cursor, drawn in screen space so they stay a constant size.
    if scene.endcard != true {
        let ws = allWaypoints[cur]
        var press: CGFloat = 1
        for w in ws where w.click {
            let age = t - w.t
            if age >= 0 && age < 0.7 {
                let u = CGFloat(age / 0.7)
                let c = toScreen(w.p)
                let radius = 10 + 46 * (1 - pow(1 - u, 3))
                ctx.setStrokeColor(CGColor(red: 0.25, green: 0.30, blue: 0.95, alpha: 0.6 * (1 - u))); ctx.setLineWidth(4)
                ctx.strokeEllipse(in: CGRect(x: c.x - radius, y: c.y - radius, width: radius * 2, height: radius * 2))
                ctx.setFillColor(CGColor(red: 0.25, green: 0.30, blue: 0.95, alpha: 0.18 * (1 - u)))
                ctx.fillEllipse(in: CGRect(x: c.x - radius, y: c.y - radius, width: radius * 2, height: radius * 2))
            }
            if age >= -0.05 && age < 0.16 { press = 0.85 }
        }
        // The cursor is hidden while the end card is up, and appears with the first scene.
        let appear = CGFloat(smooth((t - scenes[0].startTime - 0.2) / 0.5))
        let endFade: CGFloat = {
            guard let idx = scenes.firstIndex(where: { $0.endcard == true }) else { return 1 }
            return 1 - CGFloat(smooth((t - (scenes[idx].startTime - 0.4)) / 0.5))
        }()
        ctx.saveGState(); ctx.setAlpha(appear * endFade)
        drawArrow(ctx, at: toScreen(cursor), scale: 1.5 * press)
        ctx.restoreGState()
    }

    // Caption band.
    ctx.restoreGState() // back to CG's bottom-left origin for the band images
    func drawBand(_ index: Int, alpha: CGFloat) {
        guard alpha > 0, scenes[index].endcard != true else { return }
        ctx.saveGState(); ctx.setAlpha(alpha)
        ctx.draw(bands[index], in: CGRect(x: 0, y: 0, width: W, height: BAND))
        ctx.restoreGState()
    }
    let endU: CGFloat = {
        guard let idx = scenes.firstIndex(where: { $0.endcard == true }) else { return 0 }
        return CGFloat(smooth((t - (scenes[idx].startTime - 0.4)) / 0.9))
    }()
    ctx.saveGState()
    if endU > 0 { ctx.setAlpha(1 - endU) }
    drawBand(top, alpha: 1)
    if bottom != top { drawBand(bottom, alpha: mix) }
    ctx.restoreGState()
}

// MARK: encode

try? FileManager.default.removeItem(atPath: outPath)
let writer = try AVAssetWriter(outputURL: URL(fileURLWithPath: outPath), fileType: .mp4)
let videoInput = AVAssetWriterInput(mediaType: .video, outputSettings: [
    AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: W, AVVideoHeightKey: H,
    AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: 1_400_000, AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel, AVVideoMaxKeyFrameIntervalKey: 60],
])
let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: videoInput, sourcePixelBufferAttributes: [
    kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA, kCVPixelBufferWidthKey as String: W, kCVPixelBufferHeightKey as String: H,
])
let audioInput = AVAssetWriterInput(mediaType: .audio, outputSettings: [
    AVFormatIDKey: kAudioFormatMPEG4AAC, AVNumberOfChannelsKey: 2, AVSampleRateKey: 44100, AVEncoderBitRateKey: 128_000,
])
writer.shouldOptimizeForNetworkUse = true // moov atom first, so playback starts before the whole file arrives
writer.add(videoInput); writer.add(audioInput)

let audioAsset = AVURLAsset(url: URL(fileURLWithPath: timeline.audio))
let reader = try AVAssetReader(asset: audioAsset)
guard let track = audioAsset.tracks(withMediaType: .audio).first else { fail("no audio track in \(timeline.audio)") }
let readerOutput = AVAssetReaderTrackOutput(track: track, outputSettings: [
    AVFormatIDKey: kAudioFormatLinearPCM, AVLinearPCMBitDepthKey: 16, AVLinearPCMIsFloatKey: false,
    AVLinearPCMIsBigEndianKey: false, AVLinearPCMIsNonInterleaved: false, AVSampleRateKey: 44100, AVNumberOfChannelsKey: 2,
])
reader.add(readerOutput)
guard reader.startReading() else { fail("cannot read audio: \(String(describing: reader.error))") }

guard writer.startWriting() else { fail("cannot start writing: \(String(describing: writer.error))") }
writer.startSession(atSourceTime: .zero)

let totalFrames = Int((timeline.totalDuration * Double(FPS)).rounded())
var audioDone = false
func pumpAudio(upTo seconds: Double) {
    while !audioDone && audioInput.isReadyForMoreMediaData {
        guard let sample = readerOutput.copyNextSampleBuffer() else {
            audioInput.markAsFinished(); audioDone = true; return
        }
        audioInput.append(sample)
        if CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(sample)) > seconds { return }
    }
}

for n in 0..<totalFrames {
    var pb: CVPixelBuffer?
    CVPixelBufferCreate(nil, W, H, kCVPixelFormatType_32BGRA, nil, &pb)
    let buf = pb!
    CVPixelBufferLockBaseAddress(buf, [])
    let ctx = CGContext(data: CVPixelBufferGetBaseAddress(buf), width: W, height: H, bitsPerComponent: 8,
                        bytesPerRow: CVPixelBufferGetBytesPerRow(buf), space: colorSpace, bitmapInfo: bitmapInfo)!
    render(frame: n, into: ctx, dt: 1.0 / CGFloat(FPS))
    CVPixelBufferUnlockBaseAddress(buf, [])
    while !videoInput.isReadyForMoreMediaData { pumpAudio(upTo: Double(n) / Double(FPS) + 1.0); Thread.sleep(forTimeInterval: 0.002) }
    adaptor.append(buf, withPresentationTime: CMTime(value: Int64(n), timescale: Int32(FPS)))
    pumpAudio(upTo: Double(n) / Double(FPS) + 1.0)
    if n % 300 == 0 { FileHandle.standardError.write("frame \(n)/\(totalFrames)\n".data(using: .utf8)!) }
}
videoInput.markAsFinished()
while !audioDone { pumpAudio(upTo: .infinity); Thread.sleep(forTimeInterval: 0.002) }
let done = DispatchSemaphore(value: 0)
writer.finishWriting { done.signal() }
done.wait()
if writer.status != .completed { fail("encode failed: \(String(describing: writer.error))") }
print("wrote \(outPath): \(scenes.count) scenes, \(timeline.totalDuration)s")
