// Spike S2: SwiftMail probe against GreenMail (127.0.0.1:3143 IMAP, :3025 SMTP). Throwaway.
// Prints only PASS/FAIL/INFO lines. Never prints message bodies or credentials.
import Foundation
import SwiftMail

nonisolated(unsafe) var results: [(String, Bool, String)] = []
func record(_ name: String, _ ok: Bool, _ note: String = "") {
    results.append((name, ok, note))
    print("\(ok ? "PASS" : "FAIL") \(name)\(note.isEmpty ? "" : " : \(note)")")
}
func step(_ name: String, _ body: () async throws -> String?) async {
    do { let note = try await body(); record(name, true, note ?? "") }
    catch { record(name, false, "\(type(of: error)): \(String(describing: error).prefix(160))") }
}

let host = "127.0.0.1"
let alice = EmailAddress(name: "Alice", address: "alice@test.local")
let bob = EmailAddress(name: "Bob", address: "bob@test.local")

func smtpSend(subject: String, text: String) async throws {
    let smtp = SMTPServer(host: host, port: 3025, transportSecurity: .plainText)
    try await smtp.connect()
    try await smtp.login(username: "bob", password: "secret")
    _ = try await smtp.sendEmail(Email(sender: bob, recipients: [alice], subject: subject, textBody: text))
    try await smtp.disconnect()
}
let imapPort = Int(ProcessInfo.processInfo.environment["PROBE_IMAP_PORT"] ?? "3144") ?? 3144  // 3144 = rewriting proxy, 3143 = GreenMail direct
func newIMAP() -> IMAPServer { IMAPServer(host: host, port: imapPort, transportSecurity: .plainText) }

let imap = newIMAP()
await step("S2.1 connect + login (PLAIN/LOGIN) + capabilities") {
    try await imap.connect()
    try await imap.login(username: "alice", password: "secret")
    let caps = try await imap.fetchCapabilities()
    return "caps=" + caps.map { String(describing: $0) }.sorted().joined(separator: " ")
}
await step("S2.2 SMTP submit bob -> alice (x3)") {
    for i in 1...3 { try await smtpSend(subject: "probe \(i)", text: "body \(i)") }
    try await Task.sleep(for: .milliseconds(500)); return nil
}
await step("S2.3 list mailboxes") {
    let boxes = try await imap.listMailboxes()
    return boxes.map { $0.name }.joined(separator: ",")
}
var uids: [UID] = []
await step("S2.4 select INBOX + fetch envelopes/flags/structure") {
    let sel = try await imap.selectMailbox("INBOX")
    let infos = try await imap.fetchMessageInfos(uidRange: UID(1)...UID.latest)
    uids = infos.compactMap { $0.uid }
    guard infos.count == 3, let first = infos.first, let uid = first.uid else { throw IMAPError.commandFailed("expected 3 infos, got \(infos.count)") }
    let parts = try await imap.fetchStructure(uid)
    let data = try await imap.fetchPart(section: parts[0].section, of: uid)
    return "count=\(sel.messageCount) uidValidity=\(sel.uidValidity.value) uidNext=\(sel.uidNext.value) flags=\(first.flags) parts=\(parts.count) part1Bytes=\(data.count) subject=\(first.subject ?? "nil") modseq=\(String(describing: sel.highestModSequence))"
}
await step("S2.5 STORE \\Seen then re-fetch flags") {
    guard let u = uids.first else { throw IMAPError.commandFailed("no uid") }
    try await imap.store(flags: [.seen], on: MessageIdentifierSet<UID>(u), operation: .add)
    let infos = try await imap.fetchMessageInfos(uidRange: u...u)
    guard infos.first?.flags.contains(where: { if case .seen = $0 { true } else { false } }) == true else { throw IMAPError.commandFailed("seen not set") }
    return "flags=\(infos.first!.flags)"
}
await step("S2.6 CREATE Archive + MOVE (with COPYUID)") {
    try? await imap.createMailbox("Archive")
    guard uids.count >= 2 else { throw IMAPError.commandFailed("no uids") }
    let moved = try await imap.move(messages: MessageIdentifierSet<UID>(uids[1]), to: "Archive", fallback: .disabled)
    let inbox = try await imap.selectMailbox("INBOX")
    let arch = try await imap.mailboxStatus("Archive")
    return "inboxCount=\(inbox.messageCount) archiveCount=\(arch.messageCount ?? -1) copyUID=\(moved != nil)"
}
await step("S2.7 APPEND to Sent") {
    try? await imap.createMailbox("Sent")
    let raw = "From: alice@test.local\r\nTo: bob@test.local\r\nSubject: sent copy\r\nDate: \(Date().formatted(.iso8601))\r\nMessage-ID: <probe-sent@test.local>\r\n\r\nhello\r\n"
    let r = try await imap.append(rawMessage: raw, to: "Sent", flags: [.seen], internalDate: Date())
    let st = try await imap.mailboxStatus("Sent")
    return "sentCount=\(st.messageCount ?? -1) appendResult=\(r)"
}
await step("S2.8 SEARCH UNSEEN") {
    _ = try await imap.selectMailbox("INBOX")
    let found: UIDSet = try await imap.search(criteria: [.unseen])
    return "unseen=\(found.count)"
}
await step("S2.9 QRESYNC enable (expected unsupported on GreenMail)") {
    do { _ = try await imap.enable([.qresync]); return "enabled?!" }
    catch { return "not enabled as expected: \(String(describing: error).prefix(100))" }
}
await step("S2.10 IDLE wakes on delivery") {
    let idler = newIMAP()
    try await idler.connect(); try await idler.login(username: "alice", password: "secret")
    _ = try await idler.selectMailbox("INBOX")
    let stream = try await idler.idle()
    let waiter = Task { () -> String? in
        for await ev in stream { if case .exists(let n) = ev { return "exists=\(n)" } }
        return nil
    }
    try await Task.sleep(for: .milliseconds(800))
    let t0 = Date()
    try await smtpSend(subject: "idle trigger", text: "x")
    let hit = await withTaskGroup(of: String?.self) { g in
        g.addTask { await waiter.value }
        g.addTask { try? await Task.sleep(for: .seconds(10)); return nil }
        let r = await g.next() ?? nil; g.cancelAll(); return r
    }
    try? await idler.done()
    guard let hit else { throw IMAPError.commandFailed("no EXISTS within 10 s") }
    return "\(hit) after \(String(format: "%.2f", Date().timeIntervalSince(t0))) s"
}
try? await imap.logout()

// XOAUTH2 against a stub IMAP server (no network beyond loopback).
await runXOAuthStub()

let failed = results.filter { !$0.1 }
print("SUMMARY \(results.count - failed.count)/\(results.count) passed")
exit(failed.isEmpty ? 0 : 1)
