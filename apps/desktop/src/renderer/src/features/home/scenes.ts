import type { Scene } from "./scene";

/** Bundled photo URLs by path. Vite emits each file with a hashed name next to the app; nothing is fetched remotely. */
const urls = import.meta.glob<string>("../../assets/scenes/*.avif", { eager: true, query: "?url", import: "default" });

function urlOf(file: string): string {
  return urls[`../../assets/scenes/${file}`] ?? "";
}

type Entry = Omit<Scene, "url" | "id">;

/**
 * The Home photos, three per time-of-day slot. Credits and licenses mirror assets/scenes/LICENSES.md.
 * `scrim` is the alpha each photo needs behind the band text (from its measured top-band luminance).
 */
const ENTRIES: Entry[] = [
  { slot: "dawn", file: "dawn-oxbow-bend.avif", focal: "50% 40%", scrim: 0.5, tone: "dark", credit: "NPS / Bonney", place: "Oxbow Bend, Grand Teton", sourceUrl: "https://commons.wikimedia.org/wiki/File:Oxbow_Bend_(48915786766).jpg", license: "Public domain" },
  { slot: "dawn", file: "dawn-snake-river-overlook.avif", focal: "50% 50%", scrim: 0, tone: "dark", credit: "NPS / Tobiason", place: "Snake River Overlook, Grand Teton", sourceUrl: "https://commons.wikimedia.org/wiki/File:Snake_River_Overlook_(32804892492).jpg", license: "Public domain" },
  { slot: "dawn", file: "dawn-karl-mundt-refuge.avif", focal: "50% 60%", scrim: 0.36, tone: "dark", credit: "Liz Julian / USFWS", place: "Karl E. Mundt Wildlife Refuge, South Dakota", sourceUrl: "https://commons.wikimedia.org/wiki/File:Sunrise_Karl_E_Mundt_National_Wildlife_Refuge_South_Dakota_(53374522582).jpg", license: "Public domain" },
  { slot: "day", file: "day-grand-canyon-rain.avif", focal: "50% 45%", scrim: 0.32, tone: "light", credit: "Romain Guy", place: "Grand Canyon, Arizona", sourceUrl: "https://commons.wikimedia.org/wiki/File:Rain_over_Grand_Canyon.jpg", license: "CC0 1.0" },
  { slot: "day", file: "day-mount-rainier-tipsoo.avif", focal: "50% 35%", scrim: 0.6, tone: "light", credit: "NPS", place: "Tipsoo Lake, Mount Rainier", sourceUrl: "https://commons.wikimedia.org/wiki/File:Mount_Rainier_from_Tipsoo_Lake_(52c1f44b-d612-4e72-8add-f2b0843fe710).JPG", license: "Public domain" },
  { slot: "day", file: "day-zion-canyon-overlook.avif", focal: "50% 40%", scrim: 0.6, tone: "light", credit: "Julianibarra", place: "Canyon Overlook, Zion", sourceUrl: "https://commons.wikimedia.org/wiki/File:Zion_National_Park_Canyon_Overlook_Trail_View.jpg", license: "CC0 1.0" },
  { slot: "dusk", file: "dusk-schwabacher-landing.avif", focal: "50% 45%", scrim: 0.6, tone: "light", credit: "NPS / Tobiason", place: "Schwabacher Landing, Grand Teton", sourceUrl: "https://commons.wikimedia.org/wiki/File:Swabacher_Landing_Sunset_(29704127485).jpg", license: "Public domain" },
  { slot: "dusk", file: "dusk-grand-canyon-south-rim.avif", focal: "50% 50%", scrim: 0.6, tone: "light", credit: "Mgimelfarb", place: "South Rim, Grand Canyon", sourceUrl: "https://commons.wikimedia.org/wiki/File:Grand_Canyon_South_Rim_at_Sunset.jpg", license: "CC0 1.0" },
  { slot: "dusk", file: "dusk-seedskadee-refuge.avif", focal: "50% 50%", scrim: 0.6, tone: "dark", credit: "Tom Koerner / USFWS", place: "Seedskadee Wildlife Refuge, Wyoming", sourceUrl: "https://commons.wikimedia.org/wiki/File:Foggy_Sunrise_over_Seedskadee_National_Wildlife_Refuge_(21355263813).jpg", license: "Public domain" },
  { slot: "night", file: "night-big-prairie.avif", focal: "50% 40%", scrim: 0, tone: "dark", credit: "NPS / Glacier National Park", place: "Big Prairie, Glacier", sourceUrl: "https://commons.wikimedia.org/wiki/File:Milky_Way_over_Big_Prairie_(16611194397).jpg", license: "Public domain" },
  { slot: "night", file: "night-cholla-garden.avif", focal: "50% 55%", scrim: 0, tone: "dark", credit: "NPS / Anna Cirimele", place: "Cholla Cactus Garden, Joshua Tree", sourceUrl: "https://commons.wikimedia.org/wiki/File:Teddy_Bear_Cholla_and_the_Milky_Way_(53434081763).jpg", license: "Public domain" },
  { slot: "night", file: "night-turret-arch.avif", focal: "50% 40%", scrim: 0, tone: "dark", credit: "NPS / Neal Herbert", place: "Turret Arch, Arches", sourceUrl: "https://commons.wikimedia.org/wiki/File:Night_Sky_at_Turret_Arch_(9631070926).jpg", license: "Public domain" },
];

export const SCENES: readonly Scene[] = ENTRIES.map((e) => ({ ...e, id: e.file.replace(/\.avif$/, ""), url: urlOf(e.file) }));
