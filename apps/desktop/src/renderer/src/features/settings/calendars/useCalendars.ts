import { useFlintQuery } from "../../../lib/hooks";

/** Calendar accounts, including the implicit ones from Gmail sign-ins. */
export function useCalendars() {
  const q = useFlintQuery((api) => api.listCalendarAccounts(), [], { mail: false });
  return { calendars: q.data, loading: q.loading, refetch: q.refetch };
}
