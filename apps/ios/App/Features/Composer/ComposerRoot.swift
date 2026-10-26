import FlintModel
import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

/// The composer. The shell presents it for `Route.compose`; the request it was opened with is in `AppModel.presented`.
struct ComposerRoot: View {
    @Environment(AppModel.self) private var model
    @State private var held: ComposeRequest?

    private var request: ComposeRequest? {
        if case .compose(let current) = model.presented { return current }
        return held
    }

    var body: some View {
        Group {
            if let request {
                ComposerScreen(model: model, request: request).id(request)
            } else {
                FlintColor.plane1
            }
        }
        .onChange(of: model.presented, initial: true) { _, presented in
            if case .compose(let current) = presented { held = current }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("composer.root")
    }
}

/// One open draft: header, fields, editor and the sheets it opens.
struct ComposerScreen: View {
    let request: ComposeRequest
    @State private var viewModel: ComposerViewModel
    @State private var showSchedule = false
    @State private var showPhotos = false
    @State private var showFiles = false
    @State private var showCamera = false
    @State private var photoItems: [PhotosPickerItem] = []
    @Environment(\.dynamicTypeSize) private var typeSize

    init(model: AppModel, request: ComposeRequest) {
        self.request = request
        _viewModel = State(initialValue: ComposerViewModel(model: model, dismiss: { model.navigate(to: .dismiss) }))
    }

    var body: some View {
        @Bindable var vm = viewModel
        VStack(spacing: 0) {
            header
            switch vm.phase {
            case .loading: ComposerLoading()
            case .failed(let message): ComposerFailed(message: message) { viewModel.discardUnopened() }
            case .ready: ComposerForm(viewModel: viewModel)
            }
        }
        .background(FlintColor.plane1)
        .task { await viewModel.load(request) }
        .onDisappear { Task { await viewModel.finish() } }
        .sheet(isPresented: $showSchedule) {
            ScheduleSheet { date in
                Task { await viewModel.requestSend(sendAt: EpochMs(date.timeIntervalSince1970 * 1000)) }
            }
        }
        .photosPicker(isPresented: $showPhotos, selection: $photoItems, matching: .images)
        .onChange(of: photoItems) { _, items in attachPhotos(items) }
        .fileImporter(isPresented: $showFiles, allowedContentTypes: [.item], allowsMultipleSelection: true) { result in
            if case .success(let urls) = result { Task { await viewModel.attach(files: urls) } }
        }
        .fullScreenCover(isPresented: $showCamera) {
            CameraPicker { data in
                if let data { Task { await viewModel.attach(data: data, filename: "Photo \(Date().formatted(.dateTime.hour().minute().second())).jpg") } }
            }
            .ignoresSafeArea()
        }
        .alert(confirmTitle, isPresented: confirmShown, actions: { confirmActions }, message: { Text(confirmMessage) })
        .alert(String(localized: "Discard this draft?", table: "Composer"), isPresented: $vm.confirmDiscard) {
            Button(String(localized: "Keep draft", table: "Composer"), role: .cancel) {}
            Button(String(localized: "Discard", table: "Composer"), role: .destructive) { Task { await viewModel.discard() } }
        } message: {
            Text("The draft will be deleted.", tableName: "Composer")
        }
    }

    // MARK: Header

    /// At accessibility sizes the actions move to their own line under the title, so the title is not cut to "New…".
    @ViewBuilder private var header: some View {
        let stacked = typeSize.isAccessibilitySize
        VStack(spacing: 0) {
            FlintBar(
                title: viewModel.title, subtitle: saveText,
                leading: {
                    FlintIconButton(
                        icon: .close, label: String(localized: "Save and close", table: "Composer"), identifier: "composer.close",
                        action: { Task { await viewModel.close() } })
                },
                trailing: { if !stacked { headerActions } })
            if stacked && viewModel.phase == .ready {
                HStack(spacing: 0) {
                    Spacer(minLength: 0)
                    headerActions
                }
                .padding(.horizontal, FlintMetrics.Space.s2)
                .background(FlintColor.plane1)
                .overlay(alignment: .bottom) { FlintHairline() }
            }
        }
        .padding(.top, FlintMetrics.Space.s2)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("composer.header")
    }

    @ViewBuilder private var headerActions: some View {
        if viewModel.phase == .ready {
            Menu {
                Button { showPhotos = true } label: { Label(String(localized: "Photo library", table: "Composer"), systemImage: "photo") }
                    .accessibilityIdentifier("composer.attach.photos")
                Button { showFiles = true } label: { Label(String(localized: "Choose file", table: "Composer"), systemImage: "folder") }
                    .accessibilityIdentifier("composer.attach.files")
                if CameraPicker.isAvailable {
                    Button { showCamera = true } label: { Label(String(localized: "Take photo", table: "Composer"), systemImage: "camera") }
                        .accessibilityIdentifier("composer.attach.camera")
                }
            } label: {
                FlintIconView(icon: .paperclip, size: 18)
                    .frame(width: FlintMetrics.Size.touch, height: FlintMetrics.Size.touch)
                    .contentShape(Rectangle())
            }
            .accessibilityLabel(String(localized: "Attach", table: "Composer"))
            .accessibilityIdentifier("composer.attach")
            FlintIconButton(
                icon: .clock, label: String(localized: "Send later", table: "Composer"), identifier: "composer.schedule",
                action: { showSchedule = true })
                .keyboardShortcut(.return, modifiers: [.command, .shift])
            Button { Task { await viewModel.requestSend() } } label: {
                Text("Send", tableName: "Composer")
            }
            .buttonStyle(FlintButtonStyle(kind: .primary))
            .disabled(viewModel.isSending)
            .keyboardShortcut(.return, modifiers: .command)
            .padding(.leading, FlintMetrics.Space.s1)
            .accessibilityIdentifier("composer.send")
        }
    }

    private var saveText: String? {
        switch viewModel.saveState {
        case .idle: nil
        case .saving: String(localized: "Saving", table: "Composer")
        case .saved: String(localized: "Draft saved", table: "Composer")
        case .failed: String(localized: "Couldn't save", table: "Composer")
        }
    }

    // MARK: Attachments and prompts

    private func attachPhotos(_ items: [PhotosPickerItem]) {
        guard !items.isEmpty else { return }
        photoItems = []
        Task {
            for (index, item) in items.enumerated() {
                guard let data = try? await item.loadTransferable(type: Data.self) else { continue }
                let name = ComposerStaging.photoName(index: index + 1, fileExtension: item.supportedContentTypes.first?.preferredFilenameExtension)
                await viewModel.attach(data: data, filename: name)
            }
        }
    }

    private var confirmShown: Binding<Bool> {
        Binding(get: { viewModel.confirm != nil }, set: { if !$0 { viewModel.dismissConfirm() } })
    }

    private var confirmTitle: String {
        viewModel.confirm == .noAttachment
            ? String(localized: "Send without an attachment?", table: "Composer")
            : String(localized: "Send without a subject?", table: "Composer")
    }

    private var confirmMessage: String {
        viewModel.confirm == .noAttachment
            ? String(localized: "You mentioned an attachment, but nothing is attached.", table: "Composer")
            : String(localized: "This message has no subject line.", table: "Composer")
    }

    @ViewBuilder private var confirmActions: some View {
        Button(viewModel.confirm == .noAttachment ? String(localized: "Attach a file", table: "Composer") : String(localized: "Add a subject", table: "Composer"), role: .cancel) {
            let wasAttachment = viewModel.confirm == .noAttachment
            viewModel.dismissConfirm()
            if wasAttachment { showFiles = true }
        }
        Button(String(localized: "Send anyway", table: "Composer")) { Task { await viewModel.confirmSend() } }
    }
}

private struct ComposerLoading: View {
    var body: some View {
        ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            .accessibilityIdentifier("composer.loading")
    }
}

private struct ComposerFailed: View {
    let message: String
    let close: () -> Void

    var body: some View {
        VStack(spacing: FlintMetrics.Space.s4) {
            ErrorBanner(message: message, identifier: "composer.error")
            Button(action: close) { Text("Close", tableName: "Shared") }
                .buttonStyle(FlintButtonStyle(kind: .ghost))
                .accessibilityIdentifier("composer.error.close")
            Spacer()
        }
    }
}
