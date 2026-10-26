import { describe, expect, it } from "vitest";
import { descendants, parseXml, path, textOf } from "./xml";

describe("parseXml", () => {
  it("reads default-namespace and prefixed answers by local name", () => {
    const a = parseXml(`<?xml version="1.0"?><multistatus xmlns="DAV:"><response><href>/a/</href></response></multistatus>`);
    const b = parseXml(`<D:multistatus xmlns:D="DAV:"><D:response><D:href>/a/</D:href></D:response></D:multistatus>`);
    const c = parseXml(`<ns0:multistatus xmlns:ns0="DAV:"><ns0:response><ns0:href>/a/</ns0:href></ns0:response></ns0:multistatus>`);
    for (const doc of [a, b, c]) expect(textOf(path(doc, "response", "href"))).toBe("/a/");
  });

  it("decodes entities (including &#13;), CDATA and self-closing tags, and keeps attributes", () => {
    const doc = parseXml(`<r><data>A&amp;B&#13;\n&lt;x&gt;</data><raw><![CDATA[a < b & c]]></raw><comp name="VEVENT"/></r>`);
    expect(path(doc, "data")?.text).toBe("A&B\r\n<x>");
    expect(path(doc, "raw")?.text).toBe("a < b & c");
    expect(path(doc, "comp")?.attrs["name"]).toBe("VEVENT");
  });

  it("ignores comments, processing instructions and stray closers", () => {
    const doc = parseXml(`<?xml version="1.0"?><!-- hi --><a><b>1</b></zzz><b>2</b></a>`);
    expect(descendants(doc, "b").map(textOf)).toEqual(["1", "2"]);
  });

  it("throws on text without an element", () => {
    expect(() => parseXml("not xml")).toThrow();
  });
});
