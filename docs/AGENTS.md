Flint for scripts and AI agents

Flint must be running. Every command accepts --json (machine output on stdout) and
--as <name> (the name shown in Agent Activity; default $FLINT_AGENT or "cli").

IDs (all positive integers)
  thread id       "flint list", "flint search", "flint invites"; used by read, archive, trash, pin, snooze, move, reply, forward, summarize, rsvp
  message id      printed as "Message N" in "flint read"; used by unsubscribe
  attachment id   printed in "flint read" as "attachment N"; used by "flint attachment"
  draft id        printed by draft, reply, forward; used by send, draft-delete
  scheduled id    "flint queue", and the scheduledId from "flint send --json"; used by cancel
  tracked id      "flint receipts"; used by "flint receipts <id>"
  undo token      printed after every thread action as "Undo: flint undo <token>"

Exit codes
  0   success
  1   runtime error (not found, invalid input, permission denied, conflict)
  2   Flint is not running, or the watch stream ended
  64  usage error (unknown command or option)
With --json, errors are one JSON line on stderr: {"ok":false,"error":{"code":"...","message":"..."}}.
Codes: not_found, invalid, auth, network, permission, conflict, ai_not_connected, internal, usage.

JSON on success (stdout)
  list, search    {"items":[{id,subject,participants,unreadCount,lastDate,...}],"bundles":[],"nextCursor":null}
  read            {id,accountId,subject,messages:[{id,from,to,cc,date,text,html,attachments:[{id,filename,size}]}]}
  archive, trash, pin, unpin, mark-read, unread, spam, mute, unmute, unsnooze, move, snooze
                  {undoToken,threadIds}
  draft, reply, forward   the draft {id,to,cc,subject,...}
  send            {scheduledId,sendAt,undoUntil,status}   status: pending, awaiting_approval, failed, cancelled
  cancel          the draft that was kept
  queue           [{id,draftId,subject,to,sendAt,status,requestedBy}]
  drafts          [{id,to,subject,...}]
  folders         [{id,account,name,role,unread}]
  attachment      {path}
  receipts        list: [{trackedId,subject,summary}]; with an id: {recipients:[{email,status,openCount}]}
  invites         [{threadId,accountId,subject,invite:{title,start,end,allDay,state,yourResponse,organizerName}}]
  rsvp            the invitation {title,start,end,yourResponse,yourNote,...}
  watch           one event per line: {"type":"new_mail"|"receipt"|"send"|"mail_changed"|"sync"|...}

Approval flow
  Settings, Agents sets what agents may do. With sending on "ask", "flint send" returns status
  awaiting_approval and nothing is sent until the user approves it in Agent Activity (or you
  cancel it with "flint cancel <scheduledId>"). With "deny", send fails with code permission.
  "flint unsubscribe" and "flint rsvp" are refused while sending is "ask" or "deny", because they send mail
  (or change the user's calendar) without an approval step.
  With modify on "deny", only read commands work.

Search operators ("flint search <query>")
  from: to: cc: subject: in: account:   in: takes inbox, sent, drafts, trash, spam, archive or a folder name
  has:attachment   is:unread  is:read  is:pinned  is:snoozed   before:YYYY-MM-DD  after:YYYY-MM-DD
  A leading - negates ("-from:news"), "quoted phrases" match exactly.
  Anything else (filename:, label:) is treated as plain text and a warning goes to stderr.
  Only recent mail is on this computer. Add --server to also search the mail server for older matches.

Recipes
  Triage unread people mail
    flint list --unread --category people --limit 25 --json
    flint read <threadId>                 # text; HTML mail is converted, links shown as [text](url)
    flint archive <threadId>              # or pin, snooze <id> tomorrow, move <id> Receipts
  Summarize a thread
    flint summarize <threadId>            # uses the connected AI; or read it and summarize yourself
  Draft a reply (never sends by itself)
    flint reply <threadId> --body "Thanks, on it."   # prints: Draft 12 created.
    flint send 12                         # queues it; with sending on "ask" it waits for the user
  Answer a calendar invitation
    flint invites                         # upcoming invitations, YOU = your current answer
    flint rsvp <threadId> yes             # or maybe, no; --note "text" is sent to the organizer
  Find an attachment
    flint search "has:attachment from:cindy invoice" --json
    flint read <threadId>                 # lists "attachment N"
    flint attachment <N>                  # saves the file and prints its path

Triage loop
  flint list --unread --limit 25 --json
  flint read <threadId> --json
  flint archive <threadId>            # or: pin, snooze <id> tomorrow, move <id> Receipts, spam, mute
  flint undo <token>                  # if it was a mistake

Reply loop
  flint reply <threadId> --body "Thanks, on it."      # prints: Draft 12 created.
  flint send 12                                       # queues it for the undo window
  flint cancel <scheduledId>                          # within the undo window

React to new mail
  flint watch --type new_mail,receipt --reconnect
