import Foundation

/// Header and address signals used by `Categorizer`. Port of `packages/core/src/categorize/signals.ts`.
enum Signals {
    typealias Headers = [String: String]

    /// Local parts that mean a machine sent the mail, with no other evidence needed.
    static let strongLocal = JSRegex(literal: #"^(no[-_.]?reply|do[-_.]?not[-_.]?reply|automated|notifications?|calendar[-_.]?notification|alerts?|updates?|mailer(?:-daemon)?|bounces?|receipts?|billing|invoices?|statements?|orders?|order[-_.]?update|shipment[-_.]?tracking|shipping|service|dse|auto[-_.]?confirm)([-_.+0-9].*)?\z"#)
    /// Local parts that are often a real inbox, so they count only next to a bulk signal.
    static let weakLocal = JSRegex(literal: #"^(accounts?|security|support|admissions?|apply|enroll(?:ment)?|registrar|info|team|hello|help|customer[-_.]?(?:care|service)|news|marketing|offers?)([-_.+0-9].*)?\z"#)

    private static let strongLabel = JSRegex(literal: #"^(notifications?|notify|alerts?|mailer|bounces?|noreply|no-reply)\z"#)
    private static let weakLabel = JSRegex(literal: #"^(mail|email|e|em|msg|messages?|send|mg)\z"#)

    enum DomainClass { case strong, weak, news, none }

    static func subdomainClass(_ domain: String) -> DomainClass {
        let labels = domain.split(separator: ".", omittingEmptySubsequences: false).map(String.init)
        if labels.count < 3 { return .none }
        let first = labels[0]
        if first == "news" { return .news }
        if strongLabel.test(first) { return .strong }
        if weakLabel.test(first) { return .weak }
        return .none
    }

    private static func domainRe(_ names: [String]) -> JSRegex {
        let alt = names.map { $0.replacingOccurrences(of: ".", with: #"\."#) }.joined(separator: "|")
        return JSRegex(literal: #"(?:^|\.)(?:"# + alt + #")\z"#)
    }

    /// Services whose mail is always a notification stream, even when it carries list headers.
    static let alwaysNotifyDomain = domainRe([
        "github.com", "gitlab.com", "bitbucket.org", "linear.app", "atlassian.net", "atlassian.com", "slack.com", "stripe.com", "docusign.net", "docusign.com",
        "calendar.google.com", "accounts.google.com", "notion.so", "figma.com", "asana.com", "sentry.io", "vercel.com", "cloudflare.com", "zoom.us",
    ])
    /// Services that send both receipts and marketing.
    static let mixedDomain = domainRe(["amazon.com", "paypal.com", "uber.com", "linkedin.com", "venmo.com", "apple.com", "google.com", "airbnb.com", "doordash.com", "lyft.com"])

    static let transactionalSubject = JSRegex(literal: #"\b(receipt|your order|order (?:confirmation|#?\d)|invoice|payment (?:received|confirmation|failed|due)|password reset|reset your password|verification code|verify your|security alert|new sign-?in|sign-?in (?:attempt|alert)|login code|one-time|shipped|out for delivery|delivered|booking confirmation|reservation|invitation:|updated invitation|accepted:|declined:|statement is ready|your .{0,20}trip|payment to)\b"#, ignoreCase: true)

    private static let espHeader = JSRegex(literal: #"^(feedback-id|x-ses-[\w-]+|x-mailgun-[\w-]+|x-sg-[\w-]+|x-mc-user|x-mandrill-[\w-]+|x-campaign(?:id)?|x-sfmc-[\w-]+|x-sfdc-[\w-]+|x-mailin-[\w-]+|x-hs-[\w-]+|x-hubspot-[\w-]+|x-report-abuse|x-csa-complaints)\z"#)
    private static let espMailer = JSRegex(literal: #"(mailchimp|sendgrid|mandrill|mailgun|salesforce|exacttarget|marketing cloud|slate|technolutions|hubspot|constant ?contact|campaign ?monitor|klaviyo|braze|marketo|sparkpost|postmark|amazon ?ses|mailjet|sendinblue|brevo|iterable|customer\.io)"#, ignoreCase: true)
    private static let espReturnPath = JSRegex(literal: #"(amazonses\.com|sendgrid\.net|mailgun\.org|mcsv\.net|rsgsv\.net|mandrillapp\.com|exacttarget\.com|sparkpostmail\.com|mailjet\.com|hubspotemail\.net|sfmc-content\.com|salesforce\.com|technolutions\.com|slate\.)"#, ignoreCase: true)

    /// Headers whose presence marks mail from a sending platform rather than a person's mail client.
    static func hasEspSignature(_ headers: Headers) -> Bool {
        if headers.keys.contains(where: { espHeader.test($0) }) { return true }
        if espMailer.test(headers["x-mailer"] ?? "") { return true }
        return espReturnPath.test(headers["return-path"] ?? "")
    }

    static func hasTransactionalHeader(_ headers: Headers) -> Bool {
        let auto = (headers["auto-submitted"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if auto != "" && auto != "no" { return true }
        return headers.keys.contains { $0 == "x-github-reason" || $0 == "x-auto-response-suppress" || $0.hasPrefix("x-linear-") }
    }
}
