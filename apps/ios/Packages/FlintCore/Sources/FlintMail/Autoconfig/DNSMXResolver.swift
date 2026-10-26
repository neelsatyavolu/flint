// MX lookup through the system resolver (`DNSServiceQueryRecord`), so the domain is not sent to a DoH provider (track 2C).
// Everything runs on one serial queue, so the state needs no locks.

import dnssd
import FlintModel
import Foundation

private final class MXQuery: @unchecked Sendable {
    let queue = DispatchQueue(label: "co.xanom.flint.dns-mx")
    var ref: DNSServiceRef?
    var records: [MXRecord] = []
    var continuation: CheckedContinuation<[MXRecord], Error>?

    /// Call on `queue`. Resolves once.
    func finish(_ result: Result<[MXRecord], Error>) {
        guard let c = continuation else { return }
        continuation = nil
        if let ref { DNSServiceRefDeallocate(ref) }
        ref = nil
        c.resume(with: result)
    }
}

private let mxCallback: DNSServiceQueryRecordReply = { _, flags, _, errorCode, _, rrtype, _, rdlen, rdata, _, context in
    guard let context else { return }
    let query = Unmanaged<MXQuery>.fromOpaque(context).takeUnretainedValue()
    let data = rdata.map { Data(bytes: $0, count: Int(rdlen)) }
    let more = flags & kDNSServiceFlagsMoreComing != 0
    let added = flags & kDNSServiceFlagsAdd != 0 && rrtype == UInt16(kDNSServiceType_MX)
    query.queue.async {
        if errorCode != kDNSServiceErr_NoError {
            // No such record or a timeout: whatever arrived before is the answer.
            query.finish(.success(query.records))
            return
        }
        if added, let data, let record = parseMXRecordData(data) { query.records.append(record) }
        if !more { query.finish(.success(query.records)) }
    }
}

/// Throws `.network` when the resolver cannot be reached or the lookup times out with nothing; returns an empty list for "no MX".
public func resolveMXViaDNSService(_ domain: String, timeout: TimeInterval = 5) async throws -> [MXRecord] {
    let query = MXQuery()
    let retained = Unmanaged.passRetained(query)
    defer { retained.release() }
    return try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<[MXRecord], Error>) in
        query.queue.async {
            query.continuation = continuation
            var ref: DNSServiceRef?
            let status = DNSServiceQueryRecord(
                &ref, DNSServiceFlags(kDNSServiceFlagsTimeout | kDNSServiceFlagsReturnIntermediates), 0, domain, UInt16(kDNSServiceType_MX), UInt16(kDNSServiceClass_IN),
                mxCallback, retained.toOpaque())
            guard status == kDNSServiceErr_NoError, let ref else {
                query.finish(.failure(FlintError(.network, "DNS lookup failed.")))
                return
            }
            query.ref = ref
            guard DNSServiceSetDispatchQueue(ref, query.queue) == kDNSServiceErr_NoError else {
                query.finish(.failure(FlintError(.network, "DNS lookup failed.")))
                return
            }
            query.queue.asyncAfter(deadline: .now() + timeout) { query.finish(.success(query.records)) }
        }
    }
}
