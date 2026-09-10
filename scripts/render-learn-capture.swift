import AppKit
import Foundation

struct Color: Decodable {
    let buffer: [String: Double]
    var nsColor: NSColor {
        NSColor(calibratedRed: (buffer["0"] ?? 0) / 255,
                green: (buffer["1"] ?? 0) / 255,
                blue: (buffer["2"] ?? 0) / 255,
                alpha: (buffer["3"] ?? 255) / 255)
    }
}
struct Span: Decodable { let text: String; let fg: Color; let bg: Color; let attributes: Int; let width: Int }
struct Line: Decodable { let spans: [Span] }
struct Frame: Decodable { let cols: Int; let rows: Int; let lines: [Line] }

guard CommandLine.arguments.count == 3 else {
    fatalError("Usage: swift scripts/render-learn-capture.swift <capture.json> <screenshot.png>")
}
let frame = try JSONDecoder().decode(Frame.self, from: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1])))
let cellWidth = 9.0, cellHeight = 19.0, padding = 24.0
let width = Int(Double(frame.cols) * cellWidth + padding * 2)
let height = Int(Double(frame.rows) * cellHeight + padding * 2)
let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: width, pixelsHigh: height,
                             bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                             colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
NSColor(calibratedRed: 10/255, green: 14/255, blue: 19/255, alpha: 1).setFill()
NSRect(x: 0, y: 0, width: width, height: height).fill()
let normal = NSFont(name: "Menlo", size: 14) ?? NSFont.monospacedSystemFont(ofSize: 14, weight: .regular)
let strong = NSFont(name: "Menlo-Bold", size: 14) ?? NSFont.monospacedSystemFont(ofSize: 14, weight: .bold)
for (row, line) in frame.lines.enumerated() {
    var column = 0
    for span in line.spans {
        let x = padding + Double(column) * cellWidth
        let y = Double(height) - padding - Double(row + 1) * cellHeight
        span.bg.nsColor.setFill()
        NSRect(x: x, y: y, width: Double(span.width) * cellWidth, height: cellHeight).fill()
        (span.text as NSString).draw(at: NSPoint(x: x, y: y + 1), withAttributes: [
            .font: span.attributes & 1 != 0 ? strong : normal,
            .foregroundColor: span.fg.nsColor,
            .kern: cellWidth - ("M" as NSString).size(withAttributes: [.font: normal]).width
        ])
        column += span.width
    }
}
NSGraphicsContext.restoreGraphicsState()
try bitmap.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[2]))
print("Saved renderer screenshot: \(CommandLine.arguments[2])")
