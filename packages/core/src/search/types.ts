export type SearchTerm = { text: string; phrase: boolean; negated: boolean };
export type SearchFilter = { value: string; negated: boolean };

/** Structured form of a search string (SPEC section 4). Never contains raw user input that SQL could misread. */
export type ParsedSearch = {
  terms: SearchTerm[];          // bare words and quoted phrases, in order
  from: SearchFilter[];
  to: SearchFilter[];
  cc: SearchFilter[];
  subject: SearchFilter[];
  in: SearchFilter[];           // inbox, sent, drafts, trash, spam, archive or a folder name
  account: SearchFilter[];      // account email
  hasAttachment: boolean | null; // false when written as -has:attachment
  unread: boolean | null;       // is:unread = true, is:read = false
  pinned: boolean | null;
  snoozed: boolean | null;
  before: number | null;        // epoch ms, start of that local day (exclusive)
  after: number | null;         // epoch ms, start of that local day (inclusive)
};
