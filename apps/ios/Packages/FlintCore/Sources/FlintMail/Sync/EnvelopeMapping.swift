// One fetched envelope to the store's ingest shape. Port of packages/core/src/mail/sync/mapping.ts.

import FlintModel
import Foundation

public enum EnvelopeMapping {
    public static func epochMs(_ date: Date) -> EpochMs { Int((date.timeIntervalSince1970 * 1000).rounded()) }

    public static func date(fromEpochMs ms: EpochMs) -> Date { Date(timeIntervalSince1970: Double(ms) / 1000) }

    public static func flags(_ set: Set<String>) -> MessageFlags {
        MessageFlags(
            seen: set.contains(IMAPFlag.seen), flagged: set.contains(IMAPFlag.flagged),
            answered: set.contains(IMAPFlag.answered), draft: set.contains(IMAPFlag.draft))
    }

    public static func flagUpdate(_ state: FlagState) -> FlagUpdate {
        FlagUpdate(
            uid: state.uid, seen: state.flags.contains(IMAPFlag.seen), flagged: state.flags.contains(IMAPFlag.flagged),
            answered: state.flags.contains(IMAPFlag.answered), draft: state.flags.contains(IMAPFlag.draft))
    }

    /// - Parameters:
    ///   - gmail: Gmail mode: carry X-GM ids and labels.
    ///   - labelPaths: Gmail only, turns X-GM-LABELS into folder paths.
    public static func ingestMessage(
        _ env: RemoteEnvelope, gmail: Bool, labelPaths: (([String]) -> [String])?, now: EpochMs
    ) -> IngestMessage {
        let info = BodyStructureWalker.walk(env.bodyStructure)
        var headers = env.headers
        let references = MailHeaders.parseReferences(headers.removeValue(forKey: "references"))
        var gmLabels: [String]?
        if gmail, let labels = env.gmail?.labels, let labelPaths { gmLabels = labelPaths(labels) }
        return IngestMessage(
            uid: env.uid,
            gmMsgid: gmail ? env.gmail?.msgid : nil,
            gmThrid: gmail ? env.gmail?.thrid : nil,
            gmLabels: gmLabels,
            messageId: env.messageId,
            inReplyTo: env.inReplyTo,
            references: references,
            subject: env.subject,
            from: env.from.filter { !$0.address.isEmpty },
            to: env.to.filter { !$0.address.isEmpty },
            cc: env.cc.filter { !$0.address.isEmpty },
            bcc: env.bcc.filter { !$0.address.isEmpty },
            replyTo: env.replyTo.filter { !$0.address.isEmpty },
            date: (env.date ?? env.internalDate).map(epochMs) ?? now,
            flags: flags(env.flags),
            size: env.size,
            hasAttachments: info.hasRealAttachments,
            headers: headers,
            attachments: info.attachments)
    }
}
