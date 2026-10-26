import SwiftUI

/// Specimen sheet for every theme token and component. Shown only behind `FlintDebugFlags.themeGallery`.
struct ThemeGallery: View {
    @AppStorage(FlintAppearance.defaultsKey) private var appearanceRaw = FlintAppearance.system.rawValue
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        VStack(spacing: 0) {
            FlintBar(title: "Theme gallery", subtitle: scheme == .dark ? "Graphite" : "Paper") {
                FlintIconButton(icon: .refresh, label: "Cycle appearance", identifier: "gallery.cycle") { cycleAppearance() }
            }
            ScrollView {
                VStack(alignment: .leading, spacing: FlintMetrics.Space.s8) {
                    appearancePicker
                    planes
                    textColors
                    status
                    typeRoles
                    icons
                    avatars
                    rows
                    controls
                }
                .padding(FlintMetrics.Space.s4)
            }
            .background(FlintColor.plane2)
            .accessibilityIdentifier("gallery.scroll")
        }
        .background(FlintColor.plane1.ignoresSafeArea())
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("gallery.root")
    }

    private func cycleAppearance() {
        let all = FlintAppearance.allCases
        let current = FlintAppearance(rawValue: appearanceRaw) ?? .system
        appearanceRaw = all[(all.firstIndex(of: current)! + 1) % all.count].rawValue
    }

    private func section<Content: View>(_ title: String, @ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: FlintMetrics.Space.s3) {
            Text(title).flintText(.label)
            content()
        }
    }

    private var appearancePicker: some View {
        section("Appearance") {
            HStack(spacing: FlintMetrics.Space.s2) {
                ForEach(FlintAppearance.allCases, id: \.self) { option in
                    let selected = (FlintAppearance(rawValue: appearanceRaw) ?? .system) == option
                    Button(option.title) { appearanceRaw = option.rawValue }
                        .buttonStyle(FlintButtonStyle(kind: selected ? .primary : .ghost))
                        .accessibilityIdentifier("gallery.appearance.\(option.rawValue)")
                        .accessibilityAddTraits(selected ? .isSelected : [])
                }
            }
        }
    }

    private var planes: some View {
        section("Planes") {
            HStack(spacing: 0) {
                ForEach(Array(zip(["0", "1", "2", "3"], [FlintColor.plane0, FlintColor.plane1, FlintColor.plane2, FlintColor.plane3])), id: \.0) { name, color in
                    Text(name).flintText(.data, color: FlintColor.fg2)
                        .frame(maxWidth: .infinity, minHeight: 56)
                        .background(color)
                }
            }
            .overlay { Rectangle().stroke(FlintColor.line, lineWidth: 1) }
        }
    }

    private var textColors: some View {
        section("Text") {
            VStack(alignment: .leading, spacing: FlintMetrics.Space.s1) {
                Text("fg  Primary text").flintText(.body, color: FlintColor.fg)
                Text("fg-2  Secondary text, previews").flintText(.body, color: FlintColor.fg2)
                Text("fg-3  Meta, placeholders, group labels").flintText(.body, color: FlintColor.fg3)
                Text("fg-4  Disabled, empty-state mark").flintText(.body, color: FlintColor.fg4)
            }
        }
    }

    private var status: some View {
        section("Accent and status") {
            HStack(spacing: FlintMetrics.Space.s2) {
                swatch("accent", FlintColor.accent, FlintColor.accentFg)
                swatch("soft", FlintColor.accentSoft, FlintColor.fg)
                swatch("danger", FlintColor.danger, FlintColor.plane3)
                swatch("ok", FlintColor.ok, FlintColor.plane0)
                swatch("warn", FlintColor.warn, FlintColor.plane0)
            }
        }
    }

    private func swatch(_ name: String, _ fill: Color, _ text: Color) -> some View {
        Text(name).flintText(.data, color: text)
            .frame(maxWidth: .infinity, minHeight: 40)
            .background(fill, in: RoundedRectangle(cornerRadius: FlintMetrics.Radius.control))
    }

    private var typeRoles: some View {
        section("Type roles") {
            VStack(alignment: .leading, spacing: FlintMetrics.Space.s3) {
                Text("Thread subject, 21 over 28").flintText(.subject)
                Text("Compose subject").flintText(.compose)
                Text("Title: Inbox").flintText(.title)
                Text("UI body: the quick brown fox jumps over the lazy dog").flintText(.body)
                Text("UI strong: unread sender and subject").flintText(.bodyStrong)
                Text("Message: plain-text mail bodies and the composer, 14.5 over 22.").flintText(.message)
                Text("Data: 10:42 AM, 1,204 unread").flintText(.data, color: FlintColor.fg2)
                Text("Today").flintText(.label)
                Text("Prose: AI summaries and answers are set in a serif, up to 68 characters wide.").flintText(.prose)
            }
        }
    }

    private var icons: some View {
        section("Icons, Lucide 1.5 stroke") {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 44), spacing: FlintMetrics.Space.s2)], spacing: FlintMetrics.Space.s2) {
                ForEach(FlintIcon.allCases, id: \.self) { icon in
                    FlintIconView(icon: icon, size: 18)
                        .frame(width: 44, height: 44)
                        .overlay { Rectangle().stroke(FlintColor.line, lineWidth: 1) }
                }
            }
        }
    }

    private var avatars: some View {
        section("Avatars, eight hashed tints") {
            VStack(alignment: .leading, spacing: FlintMetrics.Space.s2) {
                ForEach(FlintAvatar.Size.allCases, id: \.self) { size in
                    HStack(spacing: FlintMetrics.Space.s2) {
                        ForEach(Self.avatarSamples, id: \.address) { sample in
                            FlintAvatar(address: sample.address, name: sample.name, size: size)
                        }
                    }
                }
            }
        }
    }

    private static let avatarSamples: [(address: String, name: String)] = [
        ("carla@example.com", "Carla Ruiz"), ("kayak@mail.kayak.com", "Kayak"), ("dev@flint.xanom.co", "Flint Team"),
        ("jo@example.org", "Jo Park"), ("billing@acme.test", "Acme Billing"), ("sam@example.net", "Sam"),
        ("noreply@github.com", "GitHub"), ("ana@example.com", "Ana Silva"),
    ]

    private var rows: some View {
        section("Bars and rows") {
            VStack(spacing: 0) {
                FlintBar(title: "Inbox", subtitle: "All mail") {
                    FlintIconButton(icon: .search, label: "Search") {}
                    FlintIconButton(icon: .compose, label: "Compose", color: FlintColor.accent) {}
                }
                FlintRow(senderName: "Carla Ruiz", senderAddress: "carla@example.com", subject: "Lease renewal for the Mission St office", preview: "Hi both, attached is the revised draft with the new term.", time: "10:42", isUnread: true, hasAttachment: true, messageCount: 3)
                FlintRow(senderName: "Kayak", senderAddress: "kayak@mail.kayak.com", subject: "Your trip to Lisbon", preview: "Check in opens tomorrow at 9:00.", time: "Yesterday", isPinned: true)
                FlintRow(senderName: "Jo Park", senderAddress: "jo@example.org", subject: "Selected row", preview: "The soft accent fill and a 2 pt bar mark the selection.", time: "Mon", isSelected: true)
                FlintRow(senderName: "GitHub", senderAddress: "noreply@github.com", subject: "Compact density", time: "Sun", density: .compact)
                FlintSkeletonRow()
            }
            .background(FlintColor.plane1)
            .overlay { Rectangle().stroke(FlintColor.line, lineWidth: 1) }
        }
    }

    private var controls: some View {
        section("Controls") {
            HStack(spacing: FlintMetrics.Space.s2) {
                Button("Send") {}.buttonStyle(FlintButtonStyle(kind: .primary))
                Button("Archive") {}.buttonStyle(FlintButtonStyle(kind: .secondary))
                Button("Cancel") {}.buttonStyle(FlintButtonStyle(kind: .ghost))
            }
        }
    }
}

#Preview("Graphite") { ThemeGallery().preferredColorScheme(.dark) }
#Preview("Paper") { ThemeGallery().preferredColorScheme(.light) }
