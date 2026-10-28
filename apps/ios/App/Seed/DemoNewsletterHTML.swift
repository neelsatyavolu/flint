import Foundation

/// HTML newsletters for the demo mailbox. The long one stresses the reader: table layout, inline styles, remote images,
/// a tracking pixel, many sections and a footer.
enum DemoNewsletterHTML {
    static let shortText = "Seven small habits for a quieter inbox.\n\n1. Check mail at set times.\n2. Unsubscribe the same day.\n3. Keep one folder.\n4. Write shorter replies.\n5. Snooze, do not stare.\n6. Turn off badges you do not use.\n7. End the day at zero, or do not."

    static func short() -> String {
        let habits = ["Check mail at set times.", "Unsubscribe the same day.", "Keep one folder.", "Write shorter replies.", "Snooze, do not stare.", "Turn off badges you do not use.", "End the day at zero, or do not."]
        let items = habits.map { "<li style=\"margin:0 0 8px\">\($0)</li>" }.joined()
        return """
        <html><body style="margin:0;background:#f4f2ec;font-family:Georgia,serif;color:#1c1b19">
        <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
        <table width="560" cellpadding="24" cellspacing="0" style="background:#ffffff">
        <tr><td><h1 style="font-size:26px;margin:0 0 12px">Seven small habits for a quieter inbox</h1>
        <p style="font-size:16px;line-height:1.5">You do not need a new app. You need seven small habits.</p>
        <ol style="font-size:16px;line-height:1.5">\(items)</ol>
        <p style="font-size:13px;color:#6b6860">You get this because you subscribed to The Weekly Trellis. <a href="https://trellis.example/unsubscribe">Unsubscribe</a></p>
        </td></tr></table></td></tr></table></body></html>
        """
    }

    private static let sections: [(title: String, body: String)] = [
        ("Workshop of the quarter", "A converted boathouse in the north now runs one-day workshops on joinery, with a strict rule: no power tools before lunch. We spent a Saturday there cutting dovetails by hand and came home with sore wrists and one respectable box."),
        ("Tools we reach for", "A marking knife that holds an edge for a year. A square that is actually square. A pencil sharpened with a blade, not a machine. None of these are new, which is the point."),
        ("The long essay: on finishing", "Most projects do not fail in the middle. They fail in the last ten percent, where the work is small, fiddly and has no audience. This essay follows five makers through that last stretch and asks what they did differently."),
        ("Reader mail", "Several of you wrote about the birch plywood we mentioned in the summer issue. The short version: buy it flat, store it flat, and do not trust a lumberyard that stores it leaning."),
        ("A pattern worth stealing", "A shop apron with one big pocket and one small one. The big pocket holds the plan. The small one holds the pencil. Nothing else is allowed in either."),
        ("Interview: the hinge maker", "Ines Valdivia has made hinges for thirty years and still tests every one by hand. We talked about tolerance, patience and why she refuses to automate the last step."),
        ("Marginalia", "A short list of things we read this quarter: a history of the screw, a field guide to wood grain, and a letter from a reader who restores church doors."),
        ("Next quarter", "Winter is for finishing. We will cover oils and waxes, the case against lacquer, and how to fix a mistake without anyone noticing."),
    ]

    static func long() -> String {
        let blocks = sections.enumerated().map { index, section in
            """
            <tr><td style="padding:0 0 28px">
            <img src="https://cdn.quarterlymaker.example/issue/autumn/\(index + 1).jpg" width="512" height="288" alt="" style="display:block;width:100%;height:auto;background:#d9d4c7">
            <h2 style="font-size:21px;margin:16px 0 8px;font-family:Georgia,serif">\(section.title)</h2>
            <p style="font-size:16px;line-height:1.55;margin:0 0 12px">\(section.body)</p>
            <p style="font-size:16px;line-height:1.55;margin:0">\(section.body.lowercased().capitalizedFirst) <a href="https://quarterlymaker.example/autumn/\(index + 1)" style="color:#2b5fd9">Continue reading</a></p>
            </td></tr>
            """
        }.joined(separator: "\n")
        return """
        <html><body style="margin:0;background:#efede6;font-family:Georgia,serif;color:#1c1b19">
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#efede6"><tr><td align="center" style="padding:24px 0">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;padding:32px">
        <tr><td style="padding:0 0 24px"><div style="font-size:12px;letter-spacing:3px;text-transform:uppercase;color:#6b6860">Quarterly Maker</div>
        <h1 style="font-size:32px;margin:8px 0 0">Autumn issue</h1></td></tr>
        \(blocks)
        <tr><td style="border-top:1px solid #d9d4c7;padding:20px 0 0;font-size:13px;color:#6b6860;line-height:1.5">
        You are receiving this because you subscribed at quarterlymaker.example. <a href="https://quarterlymaker.example/unsubscribe">Unsubscribe</a> or <a href="https://quarterlymaker.example/prefs">change what we send</a>.
        <br>Quarterly Maker, 12 Example Street, Exampleton.
        <img src="https://track.quarterlymaker.example/o.gif?u=abc123" width="1" height="1" alt="" style="display:block">
        </td></tr></table></td></tr></table></body></html>
        """
    }

    static var longText: String {
        let body = sections.map { "\($0.title.uppercased())\n\n\($0.body)" }.joined(separator: "\n\n")
        return "QUARTERLY MAKER, AUTUMN ISSUE\n\n\(body)\n\nUnsubscribe: https://quarterlymaker.example/unsubscribe"
    }
}

private extension String {
    var capitalizedFirst: String { prefix(1).uppercased() + dropFirst() }
}
