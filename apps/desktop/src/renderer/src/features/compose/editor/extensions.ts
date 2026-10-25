import type { Extensions } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import { Signature } from "./SignatureNode";

export function createExtensions(placeholder: string): Extensions {
  return [
    StarterKit.configure({
      heading: false,
      codeBlock: false,
      horizontalRule: false,
      link: { openOnClick: false, autolink: true, defaultProtocol: "https" },
    }),
    Image.configure({ allowBase64: true, inline: false }),
    Placeholder.configure({ placeholder }),
    Signature,
  ];
}
