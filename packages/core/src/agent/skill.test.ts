import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { installSkill, refreshSkill, removeSkill, skillMarkdown, skillStatus } from "./skill";

function home(...agents: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "flint-skill-"));
  for (const a of agents) mkdirSync(join(dir, a), { recursive: true });
  return dir;
}
const skillFile = (h: string, dir: string) => join(h, dir, "flint", "SKILL.md");

describe("flint agent skill", () => {
  it("is a valid Agent Skill with Flint's marker and version", () => {
    const md = skillMarkdown("1.2.3");
    expect(md.startsWith("---\nname: flint\ndescription: ")).toBe(true);
    expect(md).toContain('flint-version: "1.2.3"');
    expect(md).toContain("flint agents");
  });

  it("installs only for agents found on this Mac, with one shared copy for Codex and friends", () => {
    const h = home(".claude", ".codex", ".gemini");
    const status = installSkill(h, "0.1.1");
    expect(status.targets.filter((t) => t.installed).map((t) => t.id)).toEqual(["claude", "agents"]);
    expect(existsSync(skillFile(h, ".claude/skills"))).toBe(true);
    expect(existsSync(skillFile(h, ".agents/skills"))).toBe(true);
    expect(existsSync(join(h, ".codex/skills"))).toBe(false);
    expect(existsSync(join(h, ".grok"))).toBe(false);
    expect(skillStatus(h).installed).toBe(true);
  });

  it("leaves a different skill named flint alone, and won't follow a symlink", () => {
    const h = home(".claude", ".cursor");
    mkdirSync(join(h, ".claude/skills/flint"), { recursive: true });
    writeFileSync(skillFile(h, ".claude/skills"), "---\nname: flint\ndescription: rock collecting\n---\n");
    mkdirSync(join(h, "elsewhere"));
    mkdirSync(join(h, ".cursor/skills"), { recursive: true });
    symlinkSync(join(h, "elsewhere"), join(h, ".cursor/skills/flint"));
    const status = installSkill(h, "0.1.1");
    const claude = status.targets.find((t) => t.id === "claude")!;
    expect(claude.installed).toBe(false);
    expect(claude.note).toMatch(/different skill/);
    expect(readFileSync(skillFile(h, ".claude/skills"), "utf8")).toContain("rock collecting");
    expect(status.targets.find((t) => t.id === "cursor")!.installed).toBe(false);
    expect(existsSync(join(h, "elsewhere", "SKILL.md"))).toBe(false);
    removeSkill(h);
    expect(readFileSync(skillFile(h, ".claude/skills"), "utf8")).toContain("rock collecting");
  });

  it("refreshes copies from an older Flint and removes only its own", () => {
    const h = home(".claude", ".grok");
    installSkill(h, "0.1.0");
    expect(refreshSkill(h, "0.1.0")).toBe(0);
    expect(refreshSkill(h, "0.2.0")).toBe(2);
    expect(readFileSync(skillFile(h, ".grok/skills"), "utf8")).toContain('flint-version: "0.2.0"');
    const after = removeSkill(h);
    expect(after.installed).toBe(false);
    expect(existsSync(join(h, ".claude/skills/flint"))).toBe(false);
  });
});
