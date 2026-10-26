import { describe, expect, it } from "vitest";
import { withLeadingParagraph } from "./BodyEditor";

describe("withLeadingParagraph", () => {
  it("adds a paragraph above a body that starts with the signature", () => {
    expect(withLeadingParagraph('<div class="flint_signature">Sig</div>')).toBe('<p></p><div class="flint_signature">Sig</div><p></p>');
  });

  it("adds the paragraph after a trailing signature so the editor does not add one later", () => {
    expect(withLeadingParagraph('<p>Hi</p><div class="flint_signature">Sig</div>')).toBe('<p>Hi</p><div class="flint_signature">Sig</div><p></p>');
  });

  it("drops the line break a new draft puts before its signature, so there is one line to type on", () => {
    expect(withLeadingParagraph('<br><div class="flint_signature" data-signature-id="1">Sig</div>')).toBe('<p></p><div class="flint_signature" data-signature-id="1">Sig</div><p></p>');
    expect(withLeadingParagraph('<p>Hi</p><br><div class="flint_signature">Sig</div>')).toBe('<p>Hi</p><br><div class="flint_signature">Sig</div><p></p>');
  });

  it("leaves plain paragraph bodies alone", () => {
    expect(withLeadingParagraph("<p>Hi</p>")).toBe("<p>Hi</p>");
    expect(withLeadingParagraph("")).toBe("<p></p>");
  });
});
