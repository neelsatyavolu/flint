declare module "html-to-text" {
  type Node = { attribs?: Record<string, string>; children?: Node[] };
  type Builder = {
    pushWordTransform(fn: (str: string) => string): void;
    popWordTransform(): void;
    addInline(str: string, opts?: { noWordTransform?: boolean }): void;
  };
  export type FormatterFunction = (elem: Node, walk: (nodes: Node[] | undefined, builder: Builder) => void, builder: Builder, options: Record<string, unknown>) => void;
  export type ConvertOptions = {
    wordwrap?: number | false | null;
    formatters?: Record<string, FormatterFunction>;
    selectors?: { selector: string; format?: string; options?: Record<string, unknown> }[];
  };
  export function convert(html: string, options?: ConvertOptions): string;
}
