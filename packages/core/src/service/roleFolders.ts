import type { MailboxRole, ThreadId } from "../types";
import type { ServiceContext } from "./context";

/**
 * Servers like GreenMail have no Trash or Junk folder until something is moved there. Creates the local row
 * for each account involved (the move creates the mailbox on the server) so moveThreads does not fail with not_found.
 */
export function ensureRoleFolders(ctx: ServiceContext, threadIds: ThreadId[], role: MailboxRole): void {
  for (const accountId of ctx.optimistic.accountsOf(threadIds).keys()) {
    try {
      ctx.store.ensureFolderByRole(accountId, role);
    } catch {
      // Not a role with a default path; moveThreads reports it.
    }
  }
}
