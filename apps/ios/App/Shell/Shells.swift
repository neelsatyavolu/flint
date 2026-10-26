import FlintModel
import SwiftUI

/// iPad: sidebar, list and thread side by side.
struct PadShell: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model
        NavigationSplitView(columnVisibility: $model.columnVisibility) {
            FeatureRegistry.root("sidebar")
                .toolbar(.hidden, for: .navigationBar)
                .navigationSplitViewColumnWidth(min: 240, ideal: 280, max: 320)
        } content: {
            FeatureRegistry.root("inbox")
                .toolbar(.hidden, for: .navigationBar)
                .navigationSplitViewColumnWidth(min: 320, ideal: 380, max: 460)
        } detail: {
            Group {
                if model.openThread != nil {
                    FeatureRegistry.root("thread").id(model.openThread)
                } else {
                    ReaderEmptyView()
                }
            }
            .toolbar(.hidden, for: .navigationBar)
        }
        .navigationSplitViewStyle(.balanced)
        .accessibilityIdentifier("shell.pad")
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
            FeatureRegistry.root("inbox")
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
