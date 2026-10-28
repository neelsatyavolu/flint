import SwiftUI

/// App root: the launch screen while the service opens, then the shell for the size class, with the toast host and the sheets
/// on top. `-FlintThemeGallery YES` still shows the theme gallery instead.
struct RootView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.horizontalSizeClass) private var sizeClass

    var body: some View {
        Group {
            if FlintDebugFlags.themeGallery() {
                ThemeGallery()
            } else {
                content
            }
        }
        .background(FlintColor.plane1.ignoresSafeArea())
        .background { ViewKeyShortcuts() }
        .background { FindKeyCommand { if model.phase == .ready { model.navigate(to: .search(nil)) } } }
        .overlay { if model.composerPanelRequest != nil { ComposerPanelHost() } }
        .overlay { if model.presented == nil || usesComposerPanel { ToastHost(center: model.toasts) } }
        .sheet(item: sheet) { presented in
            PresentedSheet(presented: presented)
                .presentationBackground(FlintColor.plane1)
                .interactiveDismissDisabled(presented == .onboarding && model.accounts.isEmpty && !model.isDemo)
        }
        .onChange(of: sizeClass, initial: true) { _, size in model.setWide(size == .regular) }
        .onChange(of: model.presented, initial: true) { _, presented in
            // iPad has the sidebar as a column: show it there instead of in a sheet.
            if sizeClass == .regular, presented == .sidebar {
                model.columnVisibility = .all
                model.presented = nil
            }
        }
        .task {
            // The theme gallery is a design check: it opens no mailbox, so onboarding does not cover it.
            guard !FlintDebugFlags.isHostingUnitTests, !FlintDebugFlags.themeGallery() else { return }
            PerfProbe.mark("rootTask")
            await model.bootstrap()
            await model.applyLaunchRoute(LaunchRoute.fromArguments())
        }
    }

    /// iPad writes in the floating bottom-right panel, like the desktop; iPhone uses the sheet. The panel stays up while a
    /// thread, search or settings opens (`AppModel.composerPanelRequest`).
    private var usesComposerPanel: Bool {
        guard model.isWide, case .compose = model.presented else { return false }
        return true
    }

    /// The shell's sheet: everything in `presented` except what iPad shows in place (the composer panel, the sidebar column).
    private var sheet: Binding<Presented?> {
        Binding(
            get: { usesComposerPanel || (model.isWide && model.presented == .sidebar) ? nil : model.presented },
            set: { model.presented = $0 })
    }

    @ViewBuilder private var content: some View {
        switch model.phase {
        case .launching:
            LaunchView()
        case .failed(let message):
            FlintEmptyState(icon: .alert, title: String(localized: "Flint couldn't start", table: "Shell"), message: message, identifier: "shell.failed")
        case .ready:
            if sizeClass == .regular { PadShell() } else { PhoneShell() }
        }
    }
}

/// The Flint mark on the plane while the service opens.
struct LaunchView: View {
    var body: some View {
        ReaderEmptyView().accessibilityIdentifier("shell.launching")
    }
}

/// The Flint mark at 96 pt in `--fg-4` on the reader plane, nothing else (DESIGN.md "Reader, empty state").
struct ReaderEmptyView: View {
    var body: some View {
        ZStack {
            FlintColor.plane2.ignoresSafeArea()
            FlintMark()
                .stroke(FlintColor.fg4, style: StrokeStyle(lineWidth: 2, lineJoin: .round))
                .frame(width: 96, height: 96)
                .accessibilityHidden(true)
        }
        .accessibilityIdentifier("shell.empty")
    }
}

/// The faceted stone outline from the desktop app icon, in a unit square.
struct FlintMark: Shape {
    func path(in rect: CGRect) -> Path {
        let points: [(CGFloat, CGFloat)] = [(470, 250), (690, 330), (760, 560), (610, 780), (380, 740), (270, 520), (330, 330)]
        let minX: CGFloat = 270, minY: CGFloat = 250, span: CGFloat = 530
        func map(_ p: (CGFloat, CGFloat)) -> CGPoint {
            CGPoint(x: rect.minX + (p.0 - minX) / span * rect.width, y: rect.minY + (p.1 - minY) / span * rect.height)
        }
        var path = Path()
        path.addLines(points.map(map))
        path.closeSubpath()
        path.move(to: map((560, 470)))
        for p in [points[0], points[1], points[2], points[3], points[4], points[5]] {
            path.addLine(to: map(p)); path.move(to: map((560, 470)))
        }
        return path
    }
}
