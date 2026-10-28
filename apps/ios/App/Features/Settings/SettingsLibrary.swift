import FlintModel
import FlintService
import Foundation
import Observation
import SwiftUI

extension AppModel {
    /// A binding to one setting. Writing sends a one-key patch; `settings` updates from the service stream, so the control
    /// settles on the stored value (and snaps back, with an error toast, if the write failed).
    func settingBinding<Value>(
        _ read: @escaping (Settings) -> Value, section: String, key: String, encode: @escaping (Value) -> JSONValue
    ) -> Binding<Value> {
        Binding(
            get: { [weak self] in read(self?.settings ?? .default) },
            set: { [weak self] value in
                let patch = SettingsPatch.object(section, key, encode(value))
                Task { await self?.updateSettings(patch: patch) }
            })
    }

    func boolSetting(_ read: @escaping (Settings) -> Bool, section: String, key: String) -> Binding<Bool> {
        settingBinding(read, section: section, key: key, encode: { .bool($0) })
    }

    func choiceSetting<Value: RawRepresentable & Hashable>(
        _ read: @escaping (Settings) -> Value, section: String, key: String
    ) -> Binding<Value> where Value.RawValue == String {
        settingBinding(read, section: section, key: key, encode: { .string($0.rawValue) })
    }
}

/// The lists the Settings pages edit: signatures, templates, rules and blocked senders. It loads them once per Settings
/// session, applies each change through the service and keeps the local copy in step. Errors reach the person as a toast.
@MainActor @Observable
final class SettingsLibrary {
    private(set) var signatures: [Signature] = []
    private(set) var templates: [Template] = []
    private(set) var rules: [Rule] = []
    private(set) var blocked: [BlockedSender] = []
    private(set) var isLoaded = false
    private(set) var loadError: (any Error)?

    @ObservationIgnored private let model: AppModel

    init(model: AppModel) { self.model = model }

    func load() async {
        do {
            let service = try model.requireService()
            async let signatures = service.listSignatures()
            async let templates = service.listTemplates()
            async let rules = service.listRules()
            async let blocked = service.listBlocked()
            self.signatures = try await signatures
            self.templates = try await templates
            self.rules = try await rules.sorted { $0.sortOrder < $1.sortOrder }
            self.blocked = try await blocked
            loadError = nil
        } catch {
            loadError = error
        }
        isLoaded = true
    }

    // MARK: Signatures

    @discardableResult
    func save(_ signature: Signature) async -> Bool {
        await perform {
            _ = try await $0.saveSignature(signature)
            self.signatures = try await $0.listSignatures()
        }
    }

    func deleteSignature(id: Int) async -> Bool {
        await perform {
            try await $0.deleteSignature(id: id)
            self.signatures.removeAll { $0.id == id }
        }
    }

    // MARK: Templates

    @discardableResult
    func save(_ template: Template) async -> Bool {
        await perform {
            _ = try await $0.saveTemplate(template)
            self.templates = try await $0.listTemplates()
        }
    }

    func deleteTemplate(id: Int) async -> Bool {
        await perform {
            try await $0.deleteTemplate(id: id)
            self.templates.removeAll { $0.id == id }
        }
    }

    // MARK: Rules

    @discardableResult
    func save(_ rule: Rule) async -> Bool {
        await perform {
            _ = try await $0.saveRule(rule)
            self.rules = try await $0.listRules().sorted { $0.sortOrder < $1.sortOrder }
        }
    }

    func deleteRule(id: Int) async -> Bool {
        await perform {
            try await $0.deleteRule(id: id)
            self.rules.removeAll { $0.id == id }
        }
    }

    func setRule(id: Int, enabled: Bool) async {
        guard var rule = rules.first(where: { $0.id == id }) else { return }
        rule.enabled = enabled
        await save(rule)
    }

    func moveRule(id: Int, by direction: Int) async {
        guard let pair = RuleDraft.reorder(rules, id: id, by: direction) else { return }
        for rule in pair { guard await save(rule) else { return } }
    }

    /// Runs the enabled rules over the mail already in the inbox and reports how many conversations changed.
    func applyRules() async {
        _ = await perform {
            let changed = try await $0.applyRules()
            self.model.toasts.show(changed == 0 ? sl("No conversations matched") : String(format: sl("Updated %lld conversations"), changed))
        }
    }

    // MARK: Blocked senders

    func unblock(_ pattern: String) async {
        _ = await perform {
            try await $0.unblockSender(pattern)
            self.blocked.removeAll { $0.pattern == pattern }
        }
    }

    // MARK: Plumbing

    private func perform(_ work: (FlintService) async throws -> Void) async -> Bool {
        do {
            try await work(model.requireService())
            return true
        } catch {
            model.report(error)
            return false
        }
    }
}
