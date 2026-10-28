import SwiftUI

/// "How read receipts work", with what cannot be known, in the desktop's words plus the two things that differ on iPhone.
struct ReceiptsHowItWorks: View {
    var body: some View {
        VStack(alignment: .leading, spacing: FlintMetrics.Space.s3) {
            paragraph("Flint adds one tiny private image to the copy of the message each recipient receives. Every recipient gets their own address for it, so an open is tied to one person and never to the whole group.")
            paragraph("When the image loads, the receipts service records the hit and classifies it. Only hits that look like a person opening the mail count as opened. Security scanners, link previews and bots are filtered out. A reply counts as read.")
            heading("What can't be known")
            paragraph("Apple Mail Privacy Protection loads images for every message whether or not anyone looks at it. For those recipients Flint says opens can't be confirmed instead of guessing. Gmail also caches images, so the count of opens can be lower than the real number. Some people block images and will never register.")
            heading("Your own opens")
            paragraph("Your own opens never count. The copy in your Sent folder has no image, and your own addresses are never tracked.")
            heading("On this iPhone")
            paragraph("Flint has no server of its own and does not run in the background all the time. New opens are fetched when you open Flint, when you pull to refresh, and when iOS lets a background refresh run, so an alert can arrive late. Mail you send from your Mac shows its read status on the Mac only.")
            heading("What is stored")
            paragraph("The service stores no IP addresses. It keeps a one-way fingerprint that can be compared but not reversed, plus the mail app and rough location needed to tell opens from scanners. Events are deleted after 180 days.")
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("receipts.howItWorks.text")
    }

    private func paragraph(_ key: LocalizedStringKey) -> some View {
        Text(key, tableName: "Receipts").flintText(.body, color: FlintColor.fg2).fixedSize(horizontal: false, vertical: true)
    }

    private func heading(_ key: LocalizedStringKey) -> some View {
        Text(key, tableName: "Receipts").flintText(.label, color: FlintColor.fg2).textCase(.uppercase).padding(.top, FlintMetrics.Space.s1)
    }
}
