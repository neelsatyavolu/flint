import type { Address } from "@flint/core";

/** Invented people and senders. No real individuals. */
export const ME = { northwind: "alex@northwind.dev", orbit: "alex@studio-orbit.com", gmail: "alex.rivera@gmail.com" } as const;
export const ME_NAME = "Alex Rivera";

export const PEOPLE = {
  carla: { name: "Carla Mendes", address: "carla@brightfield.studio" },
  rodney: { name: "Rodney Okafor", address: "rodney@brightfield.studio" },
  priya: { name: "Priya Raman", address: "priya.raman@northwind.dev" },
  tomas: { name: "Tomas Lindqvist", address: "tomas@northwind.dev" },
  meiling: { name: "Mei-Ling Zhou", address: "meiling@halcyon-type.co" },
  daniel: { name: "Daniel Achterberg", address: "daniel@lumen-labs.io" },
  sofia: { name: "Sofia Bianchi", address: "sofia@northwind.dev" },
  jonas: { name: "Jonas Weber", address: "jonas.weber@tessera.app" },
  amara: { name: "Amara Nwosu", address: "amara@quillworks.com" },
  hiro: { name: "Hiro Tanabe", address: "hiro@studio-orbit.com" },
  elena: { name: "Elena Petrova", address: "elena@harborline.co" },
  marcus: { name: "Marcus Hale", address: "marcus.hale@harborline.co" },
  ines: { name: "Ines Duarte", address: "ines@harborline.co" },
  kofi: { name: "Kofi Mensah", address: "kofi.mensah@outlook.com" },
  lena: { name: "Lena Fischer", address: "lena.fischer@icloud.com" },
  dana: { name: "Dana Rivera", address: "dana.rivera@gmail.com" },
  omar: { name: "Omar Haddad", address: "omar@lumen-labs.io" },
  nadia: { name: "Nadia Volkova", address: "nadia@studio-orbit.com" },
} as const satisfies Record<string, Address>;
export type PersonKey = keyof typeof PEOPLE;

export const SENDERS = {
  googleSecurity: { name: "Google", address: "no-reply@accounts.google.com" },
  googleCalendar: { name: "Google Calendar", address: "calendar-notification@google.com" },
  gitforge: { name: "Gitforge", address: "notifications@gitforge.dev" },
  paycart: { name: "Paycart", address: "receipts@paycart.io" },
  trackline: { name: "Trackline", address: "no-reply@trackline.app" },
  aerolux: { name: "Aerolux", address: "bookings@aerolux.example" },
  cloudhost: { name: "Orbit Cloud", address: "billing@orbit-cloud.example" },
  margin: { name: "The Margin Note", address: "hello@themarginnote.example" },
  frontend: { name: "Frontend Weekly", address: "editor@frontendweekly.example" },
  dispatch: { name: "Dispatch Daily", address: "news@dispatchdaily.example" },
  bike: { name: "Bike Notes", address: "ride@bikenotes.example" },
  cooking: { name: "Cooking for One", address: "recipes@cookingforone.example" },
  bank: { name: "Meridian Bank", address: "alerts@meridianbank.example" },
  deliver: { name: "Parcelly", address: "updates@parcelly.example" },
} as const satisfies Record<string, Address>;
export type SenderKey = keyof typeof SENDERS;

export const ALL_CONTACTS: Address[] = [...Object.values(PEOPLE)];

export function addr(key: PersonKey | SenderKey): Address {
  return key in PEOPLE ? PEOPLE[key as PersonKey] : SENDERS[key as SenderKey];
}
