// A tiny language guess so the reader can offer "Translate" only when a thread is in
// another language. Scripts first, then stop-word counts for common Latin-script languages.
// It returns null when unsure: offering nothing is better than offering the wrong thing.

const SCRIPTS: { name: string; test: RegExp }[] = [
  { name: "Japanese", test: /[぀-ヿ]/g },
  { name: "Korean", test: /[가-힯]/g },
  { name: "Chinese", test: /[一-鿿]/g },
  { name: "Hindi", test: /[ऀ-ॿ]/g },
  { name: "Telugu", test: /[ఀ-౿]/g },
  { name: "Russian", test: /[Ѐ-ӿ]/g },
  { name: "Arabic", test: /[؀-ۿ]/g },
];

const STOPWORDS: Record<string, string> = {
  English: "the and is of to in that for you with are this have will can not your from please thanks would about just been",
  Spanish: "el los las que del por con para una es se no gracias hola está como pero más muy también esto nos sus",
  French: "le les des et est que pour pas vous nous dans avec bonjour merci je sur une ce sont aussi mais votre",
  German: "der die das und ist nicht ich sie mit für auf den ein eine zu von wir danke hallo bitte auch sind wird",
  Portuguese: "os das que em uma para com não por obrigado olá você está mais são também muito nós seu",
  Italian: "il che di per con non sono grazie ciao del della gli è anche come più questo nostro",
  Dutch: "de het een van niet voor met ik je we dank hallo zijn op ook maar dat deze wij",
};
const SETS = Object.entries(STOPWORDS).map(([name, list]) => [name, new Set(list.split(" "))] as const);

const MIN_WORDS = 20;
const MIN_HIT_RATE = 0.12;
const MIN_LEAD = 1.5;
const SAMPLE_CHARS = 3000;

/** The language name of `text` ("English", "Spanish", ...), or null when it is too short or unclear. */
export function detectLanguage(text: string): string | null {
  const sample = text.slice(0, SAMPLE_CHARS);
  const letters = sample.match(/\p{L}/gu)?.length ?? 0;
  if (letters < 20) return null;
  for (const s of SCRIPTS) {
    if ((sample.match(s.test)?.length ?? 0) / letters >= 0.3) return s.name;
  }
  const words = sample.toLowerCase().match(/\p{L}+/gu) ?? [];
  if (words.length < MIN_WORDS) return null;
  const scored = SETS.map(([name, set]) => [name, words.filter((w) => set.has(w)).length / words.length] as const).sort((a, b) => b[1] - a[1]);
  const [best, second] = scored;
  if (!best || best[1] < MIN_HIT_RATE) return null;
  if (second && second[1] > 0 && best[1] / second[1] < MIN_LEAD) return null;
  return best[0];
}
