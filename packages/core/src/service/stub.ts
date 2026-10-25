import { FlintError } from "../types";

/** Placeholder for methods another engineer is still wiring. Rejects like any failed API call. */
export const notWired = async (): Promise<never> => {
  throw new FlintError("internal", "Not wired yet");
};
