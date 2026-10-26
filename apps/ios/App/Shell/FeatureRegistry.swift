import Foundation

/// All feature modules, in display order. Track 1A owns this file; each feature adds one entry through
/// `docs/ios/HANDOFF.md`, for example `OnboardingModule()`.
@MainActor
enum FeatureRegistry {
    static let modules: [any FeatureModule] = []

    static func module(id: String) -> (any FeatureModule)? {
        modules.first { $0.id == id }
    }
}
