# S2: SwiftMail probe against GreenMail

Run 2026-10-25, macOS host, Xcode 27.1 toolchain, SwiftMail at revision `88c45cbd31b347b373f7c87e197be63eb95efbc2` (1.16.0), GreenMail 1.6.15 on Java 8. Code: `apps/ios/Spikes/s2-swiftmail` (`./run.sh` starts GreenMail on fixed ports 3143/3025, the proxy on 3144, runs the probe, stops everything). Result: **12 of 12 checks pass. Go.**

| Check | Result |
|---|---|
| Connect, LOGIN, CAPABILITY | pass. GreenMail advertises `IMAP4rev1 LITERAL+ UIDPLUS SORT IDLE MOVE QUOTA` |
| SMTP submit (SwiftMail `SMTPServer`, LOGIN auth, plaintext) | pass, 3 messages |
| LIST | pass |
| SELECT, `UID FETCH` envelopes and flags (`fetchMessageInfos`), `fetchStructure`, `fetchPart` | pass |
| STORE `\Seen` and re-fetch flags | pass |
| CREATE + MOVE to a folder with `fallback: .disabled` (real MOVE), COPYUID returned | pass, counts moved 3 to 2 and 0 to 1 |
| APPEND to Sent with `\Seen`, APPENDUID returned | pass |
| SEARCH UNSEEN | pass |
| IDLE wakes on delivery | pass, `EXISTS` arrives about 10 ms after the SMTP send |
| QRESYNC / CONDSTORE / ENABLE | not on GreenMail (`ENABLE command not supported`, no modseq in SELECT). Recorded as expected. QRESYNC and Gmail `X-GM-*` are covered by `FakeMailTransport` and SwiftMail-style embedded-channel tests, per PLAN Wave 2 |
| XOAUTH2 SASL string | pass against a loopback stub IMAP server, both with `SASL-IR` advertised (initial response on the AUTHENTICATE line) and absent (empty `+` continuation then credentials). The decoded string equals `user=<email>\x01auth=Bearer <token>\x01\x01` |

## Finding that affects tracks 2B and 5B: GreenMail is not RFC-clean on SELECT

GreenMail sends `* FLAGS (\Answered \Deleted \Draft \Flagged \Seen \*)`. `\*` is only legal inside `PERMANENTFLAGS`. swift-nio-imap's strict parser rejects the whole SELECT response (`IMAPDecoderError ... none of the options match`), so every SELECT and anything that follows it fails against a stock GreenMail, and SwiftMail then tries to reconnect.

Workaround used here and recommended for the Wave 2 integration suite: a 40-line loopback proxy (`apps/ios/Spikes/s2-swiftmail/imap-proxy.py`) that forwards bytes and drops the `\*` from untagged `* FLAGS` lines only. `apps/ios/scripts/greenmail.sh` (track 5B) should start it and point the Swift suite at the proxy port (the probe takes `PROBE_IMAP_PORT`, default 3144, and `3143` reproduces the failure). Alternatives considered: patching swift-nio-imap (not ours), or a different IMAP test server (Dovecot in Docker, heavier and not on this Mac). The proxy is only for tests; real servers do not send this.

Other notes for 2B:
- `IMAPServer` logs through swift-log at info level by default (observed: connect, host, port, command names and failures). Install a privacy-safe `LogHandler` in the app and never raise it to debug in release builds; 2B should confirm what debug level emits before ever enabling it (rule: never log bodies, tokens, passwords).
- After the SELECT parse failure SwiftMail silently re-establishes the connection ("Primary connection not authenticated; re-authenticating"). A real parse error therefore shows up as repeated reconnects; the transport should surface the first failure.
- Argument shape that worked: `IMAPServer(host:port:transportSecurity: .plainText)` for GreenMail, `.implicitTLS` for 993; `fetchMessageInfos(uidRange: UID(1)...UID.latest)`; `move(messages:to:fallback: .disabled)`.
