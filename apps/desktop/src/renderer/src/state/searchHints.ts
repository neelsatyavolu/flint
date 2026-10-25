export type SearchHint = { token: string; description: string };

const OPERATORS: SearchHint[] = [
  { token: "from:", description: "Sender" },
  { token: "to:", description: "Recipient" },
  { token: "subject:", description: "Words in the subject" },
  { token: "has:attachment", description: "With attachments" },
  { token: "is:unread", description: "Unread only" },
  { token: "is:pinned", description: "Pinned only" },
  { token: "in:", description: "Inbox, sent, drafts, archive, trash" },
  { token: "before:", description: "Before a date, YYYY-MM-DD" },
  { token: "after:", description: "After a date, YYYY-MM-DD" },
  { token: "account:", description: "One account" },
];

/** Operator suggestions for the word being typed. Empty input shows them all. */
export function searchHints(input: string): SearchHint[] {
  const last = input.split(/\s+/).pop() ?? "";
  if (last === "") return OPERATORS;
  const word = last.toLowerCase();
  if (word.includes(":") && OPERATORS.some((o) => o.token === word)) return [];
  return OPERATORS.filter((o) => o.token.startsWith(word) && o.token !== word);
}

/** Replaces the word being typed with the chosen operator. */
export function applyHint(input: string, hint: SearchHint): string {
  const head = input.replace(/\S*$/, "");
  return `${head}${hint.token}`;
}
