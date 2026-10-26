import SwiftUI

/// Colored initials in a circle. The tint is picked by hashing the address, so a sender keeps their color.
/// Sizes 16, 24 and 32; a 16 point circle shows one initial. No photos here: sender images are a later feature.
struct FlintAvatar: View {
    enum Size: CGFloat, CaseIterable, Sendable {
        case s16 = 16, s24 = 24, s32 = 32

        var fontSize: CGFloat {
            switch self {
            case .s16: 9
            case .s24: 10
            case .s32: 12
            }
        }
    }

    let address: String
    var name: String = ""
    var size: Size = .s32
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let tint = AvatarTint.color(for: address, dark: scheme == .dark)
        let letters = AvatarTint.initials(name: name, address: address)
        Text(size == .s16 ? String(letters.prefix(1)) : letters)
            .font(.custom(FlintFontRole.Face.geistSemiBold.rawValue, fixedSize: size.fontSize))
            .tracking(0.02 * size.fontSize)
            .foregroundStyle(FlintColor.avatarFg)
            .frame(width: size.rawValue, height: size.rawValue)
            .background(Color(red: tint.r, green: tint.g, blue: tint.b), in: Circle())
            // Decorative: every avatar sits next to the name or address it stands for, which VoiceOver already reads.
            .accessibilityHidden(true)
    }
}
