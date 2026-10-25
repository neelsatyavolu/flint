import { Command } from "commander";
import { collect, type CliClient, type Ctx } from "./ctx";
import { act, move, snooze, VERBS } from "./commands/actions";
import { attachment, block, blocked, cancel, contacts, deleteDraft, drafts, folders, queue, undo, unsubscribe } from "./commands/manage";
import { AGENT_GUIDE } from "./agent-guide";
import { draft, forward, reply, send } from "./commands/compose";
import { list, read, search } from "./commands/read";
import { accounts, activity, ask, receipts, status, summarize, watch } from "./commands/misc";
import { makeStyle } from "./style";

export type Deps = {
  connect(agent: string): CliClient;
  stdout(text: string): void;
  stderr(text: string): void;
  isTTY: boolean;
  columns: number;
  now(): Date;
  env: Record<string, string | undefined>;
  readFile(path: string): Promise<string>;
  sleep(ms: number): Promise<void>;
};

const EXAMPLES: Record<string, string> = {
  status: "flint status\n  flint status --json",
  accounts: "flint accounts",
  list: 'flint list --unread --limit 10\n  flint list --view pinned\n  flint list --category newsletters --account me@example.com',
  read: "flint read 1234\n  flint read 1234 --raw\n  flint read 1234 --json",
  search: 'flint search "from:cindy has:attachment"\n  flint search "invoice" --limit 5',
  draft: 'flint draft --to cindy@example.com --subject "Lunch" --body "Are you free Friday?"\n  flint draft --to a@b.co --cc c@d.co --body-file note.txt',
  reply: 'flint reply 1234 --body "Thanks, on it."\n  flint reply 1234 --all --body "Works for me."',
  forward: 'flint forward 1234 --to cindy@example.com --body "FYI"',
  send: 'flint send 12\n  flint send 12 --at "2026-10-26 09:00"\n  flint send 12 --at tomorrow\n  flint send --to a@b.co --subject Hi --body "Hello"',
  archive: "flint archive 1234 1235 1236",
  trash: "flint trash 1234",
  pin: "flint pin 1234",
  unpin: "flint unpin 1234",
  "mark-read": "flint mark-read 1234 1235",
  unread: "flint unread 1234",
  spam: "flint spam 1234",
  snooze: "flint snooze 1234 2h\n  flint snooze 1234 tomorrow\n  flint snooze 1234 monday\n  flint snooze 1234 \"2026-10-26 09:00\"",
  move: "flint move 1234 Receipts\n  flint move 1234 inbox",
  receipts: "flint receipts\n  flint receipts 7",
  summarize: "flint summarize 1234",
  ask: 'flint ask "What did Carla say about the invoice?"',
  activity: "flint activity --limit 50",
  attachment: "flint read 1234          # shows 'attachment 12'\n  flint attachment 12",
  cancel: "flint cancel 3",
  undo: "flint undo <token printed after an action>",
  unsubscribe: "flint unsubscribe 70   # message id from flint read",
  block: "flint block spammer@example.com\n  flint block '*@junk.example'",
  unblock: "flint unblock spammer@example.com",
  folders: "flint folders\n  flint folders --account me@example.com",
  contacts: "flint contacts cin\n  flint contacts cin --limit 5",
  watch: "flint watch --type new_mail,receipt --reconnect",
};

const VERB_HELP: Record<string, string> = {
  archive: "Archive threads", trash: "Move threads to trash", pin: "Pin threads", unpin: "Unpin threads",
  "mark-read": "Mark threads read (flint read prints a thread)", unread: "Mark threads unread", spam: "Mark threads as spam",
  mute: "Mute threads (new replies skip the inbox)", unmute: "Unmute threads", unsnooze: "Bring snoozed threads back now",
};

export function buildProgram(deps: Deps, jsonMode = false): Command {
  const program = new Command("flint")
    .description("Read and act on your Flint mail from the terminal. Flint must be running.")
    .option("--json", "print JSON instead of text")
    .option("--as <agent>", "name shown in Agent Activity (default: $FLINT_AGENT or cli)")
    .exitOverride() // before subcommands are added so they inherit it
    .configureOutput({ writeOut: deps.stdout, writeErr: jsonMode ? () => {} : deps.stderr }) // with --json, run() prints the error as JSON
    .showHelpAfterError("Run flint --help for the command list.");

  const ctxFor = (cmd: Command): Ctx => {
    const o = cmd.optsWithGlobals<{ json?: boolean; as?: string }>();
    const agent = o.as ?? deps.env.FLINT_AGENT ?? "cli";
    return {
      client: deps.connect(agent),
      json: o.json === true,
      out: (line) => deps.stdout(`${line}\n`),
      warn: (line) => deps.stderr(`${line}\n`),
      sleep: deps.sleep,
      now: deps.now(),
      style: makeStyle(deps.isTTY && o.json !== true),
      width: Math.max(60, deps.columns),
      readFile: deps.readFile,
    };
  };

  const command = (name: string, description: string, helpKey = name): Command => {
    const c = program.command(name).description(description).option("--json", "print JSON instead of text").option("--as <agent>", "name shown in Agent Activity");
    const ex = EXAMPLES[helpKey];
    if (ex) c.addHelpText("after", `\nExamples:\n  ${ex}`);
    return c;
  };

  command("status", "Show whether Flint is running, sync state and counts").action(async (_o, cmd: Command) => status(ctxFor(cmd)));
  command("accounts", "List accounts").action(async (_o, cmd: Command) => accounts(ctxFor(cmd)));

  command("list", "List threads")
    .option("--view <view>", "inbox, pinned, sent, drafts, archive, trash, spam or snoozed", "inbox")
    .option("--account <email>", "only this account")
    .option("--unread", "only unread threads")
    .option("--focused", "inbox only: people threads, others folded away")
    .option("--category <name>", "inbox only: people, notifications or newsletters")
    .option("--limit <n>", "how many threads (1 to 200)", "25")
    .action(async (o, cmd: Command) => list(ctxFor(cmd), o));

  command("read", "Print a thread as text")
    .argument("<threadId>")
    .option("--raw", "print bodies as stored, without converting HTML")
    .action(async (id: string, o, cmd: Command) => read(ctxFor(cmd), id, o));

  command("search", "Search mail (supports from:, to:, subject:, has:attachment, is:unread, before:, after:)")
    .argument("<query>")
    .option("--limit <n>", "how many threads (1 to 200)", "25")
    .option("--server", "also search the mail server and fetch older matches that are not on this computer yet")
    .action(async (q: string, o, cmd: Command) => search(ctxFor(cmd), q, o));

  const composeOpts = (c: Command): Command => c
    .option("--to <address>", "recipient, repeat or comma-separate", collect, [])
    .option("--cc <address>", "cc recipient", collect, [])
    .option("--bcc <address>", "bcc recipient", collect, [])
    .option("--subject <text>", "subject line")
    .option("--body <text>", "message text")
    .option("--body-file <path>", "read message text from a file");

  composeOpts(command("draft", "Create a draft (does not send)")).option("--account <email>", "send from this account")
    .action(async (o, cmd: Command) => draft(ctxFor(cmd), o));
  composeOpts(command("reply", "Create a reply draft for a thread")).argument("<threadId>").option("--all", "reply to everyone")
    .action(async (id: string, o, cmd: Command) => reply(ctxFor(cmd), id, o));
  composeOpts(command("forward", "Create a forward draft for a thread")).argument("<threadId>")
    .action(async (id: string, o, cmd: Command) => forward(ctxFor(cmd), id, o));
  composeOpts(command("send", "Send a draft, or draft and send in one step")).argument("[draftId]")
    .option("--account <email>", "send from this account")
    .option("--at <when>", 'send later: 2h, tomorrow, monday, "2026-10-26 09:00"')
    .action(async (id: string | undefined, o, cmd: Command) => send(ctxFor(cmd), id, o));

  for (const verb of Object.keys(VERBS)) {
    command(verb, VERB_HELP[verb] ?? verb)
      .argument("<threadId...>")
      .action(async (ids: string[], _o, cmd: Command) => act(ctxFor(cmd), verb, ids));
  }

  command("snooze", "Hide a thread until later")
    .argument("<threadId>").argument("<when>", "2h, 30m, tomorrow (8am), monday, 2026-10-26, \"2026-10-26 09:00\"")
    .action(async (id: string, when: string, _o, cmd: Command) => snooze(ctxFor(cmd), id, when));
  command("move", "Move a thread to a folder by name, path or role")
    .argument("<threadId>").argument("<folder>")
    .action(async (id: string, folder: string, _o, cmd: Command) => move(ctxFor(cmd), id, folder));
  command("attachment", "Save an attachment to the downloads folder and print its path")
    .argument("<attachmentId>").action(async (id: string, _o, cmd: Command) => attachment(ctxFor(cmd), id));
  command("cancel", "Cancel a queued send (it stays a draft)")
    .argument("<scheduledId>").action(async (id: string, _o, cmd: Command) => cancel(ctxFor(cmd), id));
  command("undo", "Undo an action using the token printed after it")
    .argument("<token>").action(async (t: string, _o, cmd: Command) => undo(ctxFor(cmd), t));
  command("unsubscribe", "Unsubscribe from the sender of a message (not allowed while sending needs approval)")
    .argument("<messageId>").action(async (id: string, _o, cmd: Command) => unsubscribe(ctxFor(cmd), id));
  command("block", "Block a sender address or pattern")
    .argument("<pattern>").action(async (p: string, _o, cmd: Command) => block(ctxFor(cmd), p, true));
  command("unblock", "Unblock a sender address or pattern")
    .argument("<pattern>").action(async (p: string, _o, cmd: Command) => block(ctxFor(cmd), p, false));
  command("blocked", "List blocked senders").action(async (_o, cmd: Command) => blocked(ctxFor(cmd)));
  command("folders", "List folders (use a name with flint move)")
    .option("--account <email>", "only this account").action(async (o, cmd: Command) => folders(ctxFor(cmd), o));
  command("drafts", "List drafts").action(async (_o, cmd: Command) => drafts(ctxFor(cmd)));
  command("draft-delete", "Delete a draft").argument("<draftId>").action(async (id: string, _o, cmd: Command) => deleteDraft(ctxFor(cmd), id));
  command("queue", "List queued, scheduled and awaiting-approval sends").action(async (_o, cmd: Command) => queue(ctxFor(cmd)));
  command("contacts", "Find contacts by name or address prefix")
    .argument("<prefix>").option("--limit <n>", "how many (1 to 200)", "10")
    .action(async (p: string, o, cmd: Command) => contacts(ctxFor(cmd), p, o));
  command("receipts", "List tracked mail, or show one tracked message's recipients")
    .argument("[trackedId]").option("--limit <n>", "how many (1 to 200)", "25")
    .action(async (id: string | undefined, o, cmd: Command) => receipts(ctxFor(cmd), id, o));
  command("summarize", "Summarize a thread with your connected AI")
    .argument("<threadId>").action(async (id: string, _o, cmd: Command) => summarize(ctxFor(cmd), id));
  command("ask", "Ask a question about your mail with your connected AI")
    .argument("<question>").action(async (q: string, _o, cmd: Command) => ask(ctxFor(cmd), q));
  command("watch", "Stream Flint events as JSON lines until interrupted (exit 2 if Flint goes away)")
    .option("--type <types>", "only these event types, comma-separated (new_mail, receipt, send, mail_changed, sync, ...)", collect, [])
    .option("--reconnect", "keep retrying with backoff when Flint goes away")
    .action(async (o, cmd: Command) => watch(ctxFor(cmd), o));
  command("activity", "Show recent agent activity")
    .option("--limit <n>", "how many (1 to 200)", "20")
    .action(async (o, cmd: Command) => activity(ctxFor(cmd), o));

  program.command("agents").description("Guide for scripts and AI agents: IDs, JSON, exit codes, approval flow")
    .addHelpText("after", `\n${AGENT_GUIDE}`)
    .action(() => deps.stdout(AGENT_GUIDE));

  return program;
}
