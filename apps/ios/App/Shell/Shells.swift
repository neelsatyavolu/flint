import FlintModel
import SwiftUI

/// iPad: sidebar, list and thread side by side as flat planes with hairlines, like the desktop window. Drawn by hand rather
/// than with `NavigationSplitView`, whose iOS 26 sidebar floats on system glass (DESIGN.md: no glass on app chrome).
/// Narrow windows (portrait 11-inch, Split View) keep the sidebar hidden and show it over the list when asked.
struct PadShell: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dynamicTypeSize) private var typeSize
    static let wideWidth: CGFloat = 1000
    static let sidebarWidth: CGFloat = 280
    static let listWidth: CGFloat = 380

    var body: some View {
        GeometryReader { proxy in
            // Accessibility text sizes need the room: the sidebar steps aside and the list gets wider.
            let wide = proxy.size.width >= Self.wideWidth && !typeSize.isAccessibilitySize
            let listWidth = typeSize.isAccessibilitySize ? Self.listWidth * 1.3 : Self.listWidth
            let sidebarShown = model.columnVisibility == .all
            HStack(spacing: 0) {
                if wide, sidebarShown {
                    sidebar.frame(width: Self.sidebarWidth)
                    VerticalHairline()
                }
                InboxWithCodes().frame(width: min(listWidth, proxy.size.width * (wide ? 0.4 : 0.5)))
                VerticalHairline()
                detail.frame(maxWidth: .infinity)
            }
            .overlay(alignment: .leading) {
                if !wide, sidebarShown { narrowSidebar }
            }
            .onChange(of: model.mailbox) { _, _ in
                if !wide { model.columnVisibility = .doubleColumn }
            }
            .onAppear {
                if !wide, model.columnVisibility == .all { model.columnVisibility = .doubleColumn }
            }
        }
        .flintAnimation(FlintMetrics.Motion.panel, value: model.columnVisibility)
        // No `shell.pad` identifier: on this container it replaced the columns' own ids (`inbox.root`, `thread.root`).
    }

    private var sidebar: some View {
        FeatureRegistry.root("sidebar")
    }

    @ViewBuilder private var detail: some View {
        if model.openThread != nil {
            FeatureRegistry.root("thread").id(model.openThread)
        } else {
            ReaderEmptyView()
        }
    }

    /// The sidebar over the list; a tap beside it closes it.
    private var narrowSidebar: some View {
        HStack(spacing: 0) {
            sidebar.frame(width: Self.sidebarWidth)
            VerticalHairline()
            Color.clear
                .contentShape(Rectangle())
                .onTapGesture { model.columnVisibility = .doubleColumn }
                .accessibilityHidden(true)
        }
        .transition(.move(edge: .leading))
    }
}

/// A 1 px vertical rule between columns.
struct VerticalHairline: View {
    @Environment(\.displayScale) private var scale

    var body: some View {
        FlintColor.line.frame(width: 1 / max(scale, 1)).accessibilityHidden(true)
    }
}

/// iPhone: the list is the first screen, a thread is pushed on top, and the sidebar is a sheet.
struct PhoneShell: View {
    @Environment(AppModel.self) private var model

    private var path: Binding<[ThreadID]> {
        Binding(
            get: { model.openThread.map { [$0] } ?? [] },
            set: { model.openThread = $0.last })
    }

    var body: some View {
        NavigationStack(path: path) {
            InboxWithCodes()
                .toolbar(.hidden, for: .navigationBar)
                .navigationDestination(for: ThreadID.self) { _ in
                    FeatureRegistry.root("thread").toolbar(.hidden, for: .navigationBar)
                }
        }
        .accessibilityIdentifier("shell.phone")
    }
}

/// The content of the shell's sheet for each `Presented` case.
struct PresentedSheet: View {
    @Environment(AppModel.self) private var model
    let presented: Presented

    var body: some View {
        Group {
            switch presented {
            case .sidebar: FeatureRegistry.root("sidebar")
            case .compose: FeatureRegistry.root("composer")
            case .search: FeatureRegistry.root("search")
            case .settings: FeatureRegistry.root("settings")
            case .onboarding: FeatureRegistry.root("onboarding")
            }
        }
        .background(FlintColor.plane1.ignoresSafeArea())
        .overlay { ToastHost(center: model.toasts) }
    }
}

/// The inbox with the Codes strip above it (DESIGN-NOTES section 9). The strip takes no room without a fresh code.
struct InboxWithCodes: View {
    var body: some View {
        VStack(spacing: 0) {
            CodesStrip()
            FeatureRegistry.root("inbox")
        }
    }
}
