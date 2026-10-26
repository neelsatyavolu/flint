import Foundation
import UIKit

/// Small generated files for demo attachments, so Quick Look has something real to show.
enum SeedFiles {
    static func png(width: Int, height: Int, hue: CGFloat) -> Data {
        let size = CGSize(width: width, height: height)
        let renderer = UIGraphicsImageRenderer(size: size)
        return renderer.pngData { context in
            let colors = [
                UIColor(hue: hue, saturation: 0.35, brightness: 0.55, alpha: 1).cgColor,
                UIColor(hue: hue, saturation: 0.55, brightness: 0.25, alpha: 1).cgColor,
            ]
            guard let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors as CFArray, locations: [0, 1]) else { return }
            context.cgContext.drawLinearGradient(gradient, start: .zero, end: CGPoint(x: size.width, y: size.height), options: [])
        }
    }

    static func pdf(title: String, lines: [String]) -> Data {
        let page = CGRect(x: 0, y: 0, width: 612, height: 792)
        let renderer = UIGraphicsPDFRenderer(bounds: page)
        return renderer.pdfData { context in
            context.beginPage()
            title.draw(at: CGPoint(x: 56, y: 56), withAttributes: [.font: UIFont.boldSystemFont(ofSize: 22)])
            var y: CGFloat = 104
            for line in lines {
                line.draw(in: CGRect(x: 56, y: y, width: 500, height: 40), withAttributes: [.font: UIFont.systemFont(ofSize: 13)])
                y += 26
            }
        }
    }

    static func calendarInvite(uid: String, title: String, location: String, organizer: String, attendee: String, start: Date, minutes: Int) -> Data {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.dateFormat = "yyyyMMdd'T'HHmmss'Z'"
        let end = start.addingTimeInterval(Double(minutes) * 60)
        let lines = [
            "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Flint Demo//EN", "METHOD:REQUEST", "BEGIN:VEVENT",
            "UID:\(uid)", "DTSTAMP:\(formatter.string(from: start.addingTimeInterval(-86_400)))",
            "DTSTART:\(formatter.string(from: start))", "DTEND:\(formatter.string(from: end))",
            "SUMMARY:\(title)", "LOCATION:\(location)", "ORGANIZER;CN=Organizer:mailto:\(organizer)",
            "ATTENDEE;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:\(attendee)", "END:VEVENT", "END:VCALENDAR",
        ]
        return Data(lines.joined(separator: "\r\n").utf8)
    }
}
