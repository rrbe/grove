import { describe, expect, it } from "vitest";
import { generateBranchName } from "./branch-name-gen";

describe("generateBranchName", () => {
  it("starts with worktree/ prefix", () => {
    const name = generateBranchName();
    expect(name.startsWith("worktree/")).toBe(true);
  });

  it("has three hyphen-separated words after prefix", () => {
    const name = generateBranchName();
    const slug = name.replace("worktree/", "");
    const parts = slug.split("-");
    expect(parts).toHaveLength(3);
    parts.forEach((part) => {
      expect(part.length).toBeGreaterThan(0);
      expect(part).toMatch(/^[a-z]+$/);
    });
  });

  it("generates different names on subsequent calls", () => {
    const names = new Set(Array.from({ length: 20 }, () => generateBranchName()));
    // With 64^3 = 262144 combinations, 20 calls should be unique
    expect(names.size).toBeGreaterThan(1);
  });
});
