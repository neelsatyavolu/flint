declare module "html-to-text" {
  export type ConvertOptions = {
    wordwrap?: number | false | null;
    selectors?: { selector: string; format?: string; options?: Record<string, unknown> }[];
  };
  export function convert(html: string, options?: ConvertOptions): string;
}
