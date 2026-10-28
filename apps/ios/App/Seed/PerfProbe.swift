import Darwin
import Foundation
import os

/// Launch and memory numbers for the perf seed. Timing uses the process start time, so it covers everything from `exec` to the
/// first inbox rows being handed to the view. It is armed only by `-FlintPerfReport YES` and records numbers, never mail content.
///
/// `scripts/perf-launch.sh` reads the JSON this writes to Caches/flint-perf-report.json. The same interval is emitted as an
/// os_signpost ("FirstRows" in the "co.xanom.flint.perf" category) for Instruments.
enum PerfProbe {
    private static let signposter = OSSignposter(subsystem: "co.xanom.flint", category: "perf")
    nonisolated(unsafe) private static var reported = false
    private static let marks = OSAllocatedUnfairLock(initialState: [(name: String, ms: Double)]())

    /// Records a named point, in ms since the process started (`seedStart`, `storeOpen`, `seedDone` come from `PerfSeed`).
    static func mark(_ name: String) {
        guard isArmed else { return }
        let ms = Date().timeIntervalSince(processStart()) * 1000
        marks.withLock { $0.append((name, ms)) }
    }

    static var isArmed: Bool {
        #if DEBUG || FLINT_PERF
        UserDefaults.standard.bool(forKey: "FlintPerfReport")
        #else
        false
        #endif
    }

    /// Call when the inbox first has rows. Later calls do nothing.
    @MainActor static func firstRows(count: Int) {
        guard isArmed, !reported, count > 0 else { return }
        reported = true
        let sinceStart = Date().timeIntervalSince(processStart()) * 1000
        signposter.emitEvent("FirstRows", "\(Int(sinceStart)) ms")
        Task { await sampleAndWrite(firstRowsMs: sinceStart, rows: count) }
    }

    private static func sampleAndWrite(firstRowsMs: Double, rows: Int) async {
        var samples: [(second: Int, mb: Double)] = []
        var elapsed = 0
        for next in [1, 3, 6, 10] {
            try? await Task.sleep(for: .seconds(next - elapsed))
            elapsed = next
            samples.append((next, footprintMB()))
        }
        let memory = samples.map { "\"\($0.second)\": \(String(format: "%.1f", $0.mb))" }.joined(separator: ", ")
        let stages = marks.withLock { $0 }.map { "\"\($0.name)\": \(String(format: "%.0f", $0.ms))" }.joined(separator: ", ")
        let json = "{\"firstRowsMs\": \(String(format: "%.0f", firstRowsMs)), \"rows\": \(rows), \"stagesMs\": {\(stages)}, \"footprintMBAtSecond\": {\(memory)}}\n"
        guard let caches = try? FileManager.default.url(for: .cachesDirectory, in: .userDomainMask, appropriateFor: nil, create: true) else { return }
        try? json.write(to: caches.appendingPathComponent("flint-perf-report.json"), atomically: true, encoding: .utf8)
    }

    /// `phys_footprint`: the number Xcode's memory gauge shows.
    static func footprintMB() -> Double {
        var info = task_vm_info_data_t()
        var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<integer_t>.size)
        let result = withUnsafeMutablePointer(to: &info) {
            $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) { task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count) }
        }
        return result == KERN_SUCCESS ? Double(info.phys_footprint) / 1_048_576 : 0
    }

    private static func processStart() -> Date {
        var info = kinfo_proc()
        var size = MemoryLayout<kinfo_proc>.size
        var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, getpid()]
        guard sysctl(&mib, UInt32(mib.count), &info, &size, nil, 0) == 0 else { return Date() }
        let start = info.kp_proc.p_starttime
        return Date(timeIntervalSince1970: TimeInterval(start.tv_sec) + TimeInterval(start.tv_usec) / 1_000_000)
    }
}
