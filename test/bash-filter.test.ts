import { describe, it, expect } from "vitest";
import { BashFilter } from "../src/bash-filter";

describe("BashFilter", () => {
  const filter = new BashFilter();

  describe("SAFE commands", () => {
    it("allows read commands", () => {
      expect(filter.isSafe("cat file.ts")).toBe(true);
      expect(filter.isSafe("head -n 10 file.ts")).toBe(true);
      expect(filter.isSafe("tail -f file.ts")).toBe(true);
      expect(filter.isSafe("less file.ts")).toBe(true);
      expect(filter.isSafe("wc -l file.ts")).toBe(true);
    });

    it("allows directory listing", () => {
      expect(filter.isSafe("ls")).toBe(true);
      expect(filter.isSafe("ls -la")).toBe(true);
      expect(filter.isSafe("find . -name '*.ts'")).toBe(true);
      expect(filter.isSafe("tree src/")).toBe(true);
    });

    it("allows text search", () => {
      expect(filter.isSafe("grep -r 'hello' src/")).toBe(true);
      expect(filter.isSafe("rg 'TODO'")).toBe(true);
      expect(filter.isSafe("ag pattern/")).toBe(true);
    });

    it("allows read-only git commands", () => {
      expect(filter.isSafe("git status")).toBe(true);
      expect(filter.isSafe("git log --oneline")).toBe(true);
      expect(filter.isSafe("git diff HEAD")).toBe(true);
      expect(filter.isSafe("git show HEAD:src/file.ts")).toBe(true);
      expect(filter.isSafe("git branch")).toBe(true);
      expect(filter.isSafe("git tag")).toBe(true);
      expect(filter.isSafe("git rev-parse HEAD")).toBe(true);
      expect(filter.isSafe("git describe HEAD")).toBe(true);
      expect(filter.isSafe("git ls-files")).toBe(true);
    });

    it("allows info/process commands", () => {
      expect(filter.isSafe("ps aux")).toBe(true);
      expect(filter.isSafe("env")).toBe(true);
      expect(filter.isSafe("uname -a")).toBe(true);
      expect(filter.isSafe("whoami")).toBe(true);
      expect(filter.isSafe("id")).toBe(true);
    });

    it("allows read-only package commands", () => {
      expect(filter.isSafe("npm list")).toBe(true);
      expect(filter.isSafe("npm info express")).toBe(true);
      expect(filter.isSafe("yarn list")).toBe(true);
      expect(filter.isSafe("pip list")).toBe(true);
    });

    it("allows help commands", () => {
      expect(filter.isSafe("man ls")).toBe(true);
      expect(filter.isSafe("command --help")).toBe(true);
      expect(filter.isSafe("command -h")).toBe(true);
    });

    it("allows empty/whitespace commands", () => {
      expect(filter.isSafe("")).toBe(true);
      expect(filter.isSafe("   ")).toBe(true);
    });
  });

  describe("DANGEROUS commands", () => {
    it("blocks destructive commands", () => {
      expect(filter.isSafe("rm file.txt")).toBe(false);
      expect(filter.isSafe("rm -rf src/")).toBe(false);
      expect(filter.isSafe("unlink file")).toBe(false);
      expect(filter.isSafe("truncate file")).toBe(false);
      expect(filter.isSafe("shred file")).toBe(false);
    });

    it("blocks file redirects", () => {
      expect(filter.isSafe("echo hello > file.txt")).toBe(false);
      expect(filter.isSafe("cat file.txt >> log.txt")).toBe(false);
      expect(filter.isSafe("ls |> output.txt")).toBe(false);
    });

    it("blocks mutating git commands", () => {
      expect(filter.isSafe("git commit -m 'fix'")).toBe(false);
      expect(filter.isSafe("git push")).toBe(false);
      expect(filter.isSafe("git pull")).toBe(false);
      expect(filter.isSafe("git merge feature")).toBe(false);
      expect(filter.isSafe("git rebase HEAD~3")).toBe(false);
      expect(filter.isSafe("git reset --hard")).toBe(false);
      expect(filter.isSafe("git reset --mixed")).toBe(false);
      expect(filter.isSafe("git checkout -b new-branch")).toBe(false);
      expect(filter.isSafe("git push --force")).toBe(false);
      expect(filter.isSafe("git push -f")).toBe(false);
    });

    it("blocks package installation", () => {
      expect(filter.isSafe("npm install")).toBe(false);
      expect(filter.isSafe("npm install express")).toBe(false);
      expect(filter.isSafe("yarn add lodash")).toBe(false);
      expect(filter.isSafe("yarn remove lodash")).toBe(false);
      expect(filter.isSafe("pip install flask")).toBe(false);
      expect(filter.isSafe("pip uninstall flask")).toBe(false);
    });

    it("blocks sudo", () => {
      expect(filter.isSafe("sudo apt update")).toBe(false);
    });

    it("blocks file modification", () => {
      expect(filter.isSafe("mv old.txt new.txt")).toBe(false);
      expect(filter.isSafe("cp -r src/ dst/")).toBe(false);
      expect(filter.isSafe("chmod 755 file.sh")).toBe(false);
      expect(filter.isSafe("chown user:group file")).toBe(false);
    });

    it("blocks network writes", () => {
      expect(filter.isSafe("curl -X POST http://example.com")).toBe(false);
      expect(filter.isSafe("curl -X PUT http://example.com")).toBe(false);
      expect(filter.isSafe("curl -X DELETE http://example.com")).toBe(false);
      expect(filter.isSafe("curl -X PATCH http://example.com")).toBe(false);
      expect(filter.isSafe("wget -O file http://example.com")).toBe(false);
    });

    it("blocks unknown commands by default", () => {
      expect(filter.isSafe("format-disk")).toBe(false);
      expect(filter.isSafe("some-unknown-command")).toBe(false);
    });
  });
});
