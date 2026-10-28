import FlintModel

/// Which conversation the next/previous key opens, from the order of the list.
enum ThreadStepper {
    /// The row `delta` steps from `current`, or nil at either end. With nothing open, or a thread that is not in the list
    /// (opened from search), the first row.
    static func target(in ids: [ThreadID], from current: ThreadID?, delta: Int) -> ThreadID? {
        guard !ids.isEmpty else { return nil }
        guard let current, let index = ids.firstIndex(of: current) else { return ids.first }
        let next = index + delta
        return ids.indices.contains(next) ? ids[next] : nil
    }
}
