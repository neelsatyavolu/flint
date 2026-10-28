import SwiftUI

/// The Lucide subset the app uses (ISC license), stroke 1.5, in `Icons.xcassets` as template images.
/// Raw values are the asset names. SF Symbols are only for system chrome such as share.
enum FlintIcon: String, CaseIterable, Sendable {
    case inbox = "Inbox"
    case archive = "Archive"
    case trash = "Trash"
    case pin = "Pin"
    case clock = "Clock"
    case send = "Send"
    case compose = "SquarePen"
    case search = "Search"
    case settings = "Settings"
    case paperclip = "Paperclip"
    case bell = "Bell"
    case newspaper = "Newspaper"
    case check = "Check"
    case chevronRight = "ChevronRight"
    case chevronDown = "ChevronDown"
    case chevronLeft = "ChevronLeft"
    case reply = "Reply"
    case replyAll = "ReplyAll"
    case forward = "Forward"
    case menu = "Menu"
    case close = "X"
    case plus = "Plus"
    case eye = "Eye"
    case mail = "Mail"
    case mailOpen = "MailOpen"
    case folder = "Folder"
    case fileText = "FileText"
    case more = "Ellipsis"
    case refresh = "RefreshCw"
    case sliders = "SlidersHorizontal"
    case user = "User"
    case pencil = "Pencil"
    case shield = "Shield"
    case lock = "Lock"
    case tag = "Tag"
    case calendar = "Calendar"
    case ban = "Ban"
    case undo = "Undo2"
    case copy = "Copy"
    case panelLeft = "PanelLeft"
    case qrCode = "QrCode"
    case smartphone = "Smartphone"
    case alert = "CircleAlert"
    case wifiOff = "WifiOff"
    case keyboard = "Keyboard"
    case flame = "Flame"
    case image = "Image"
    case download = "Download"
    case arrowLeft = "ArrowLeft"
}

/// A Lucide glyph at a fixed size. 16 in lists and nav, 18 in toolbars. `--fg-2` unless told otherwise.
struct FlintIconView: View {
    let icon: FlintIcon
    var size: CGFloat = 16
    var color: Color = FlintColor.fg2

    var body: some View {
        Image(icon.rawValue)
            .renderingMode(.template)
            .resizable()
            .scaledToFit()
            .frame(width: size, height: size)
            .foregroundStyle(color)
            .accessibilityHidden(true)
    }
}
