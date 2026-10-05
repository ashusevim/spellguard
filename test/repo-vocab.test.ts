import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { harvestRepoVocab } from "../repo-vocab.ts";

function tmpRepo(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "repovocab-"));
}

function write(repo: string, rel: string, content: string): string {
  const file = path.join(repo, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}

test("manifest dependency names are trusted unconditionally", () => {
  const repo = tmpRepo();
  write(repo, "package.json", JSON.stringify({
    name: "my-tool",
    keywords: [" SpellCheck ", "cli"],
    dependencies: { "kubernets-kit": "^1.0.0", "@scope/typo-js": "^1.2.5" },
    devDependencies: { vitest: "^1.0.0" },
  }));
  const result = harvestRepoVocab({ root: repo });
  for (const word of ["kubernets", "kit", "scope", "spellcheck", "typo", "vitest"]) {
    assert.ok(result.words.includes(word), `expected '${word}' in vocab, got: ${result.words.join(", ")}`);
  }
});

test("identifier words need minWordCount occurrences", () => {
  const repo = tmpRepo();
  write(repo, "src/index.ts", [
    "const kubernetsClient = 1;",
    "function useKubernetsClient() {}",
    "export { kubernetsClient, useKubernetsClient };",
    "// one-off: zorpish should not be blessed",
  ].join("\n"));
  const result = harvestRepoVocab({ root: repo });
  assert.ok(result.words.includes("kubernets"), "3 occurrences pass the threshold");
  assert.ok(!result.words.includes("zorpish"), "one-off typos are never blessed");
});

test("filename words count toward the threshold", () => {
  const repo = tmpRepo();
  for (const name of ["zorp-a.ts", "zorp-b.ts", "zorp-c.ts"]) {
    write(repo, name, "export {};\n");
  }
  const result = harvestRepoVocab({ root: repo });
  assert.ok(result.words.includes("zorp"));
});

test("go.mod, Cargo.toml, and requirements.txt manifests are harvested", () => {
  const repo = tmpRepo();
  write(repo, "go.mod", `module example.com/kubernetctl\n\ngo 1.22\n\nrequire (\n\tgithub.com/spf13/kubernets v1.0.0\n)\n`);
  write(repo, "Cargo.toml", `[package]\nname = "wrodcount"\n\n[dependencies]\nserde = "1.0"\n`);
  write(repo, "requirements.txt", "djangoo>=4.0\n# comment\n-r base.txt\n");
  const result = harvestRepoVocab({ root: repo });
  for (const word of ["kubernetctl", "kubernets", "wrodcount", "serde", "djangoo"]) {
    assert.ok(result.words.includes(word), `expected '${word}' in vocab, got: ${result.words.join(", ")}`);
  }
});

test("dependency directories and lockfiles are skipped", () => {
  const repo = tmpRepo();
  write(repo, "package.json", JSON.stringify({ name: "app", dependencies: { leftpad: "1.0.0" } }));
  write(repo, "node_modules/leftpad/index.js", "const kubernetesss = 1;\nconst kubernetesss2 = 1;\nconst kubernetesss3 = 1;\n");
  write(repo, "package-lock.json", "lockfile junk kubernetesssss");
  const result = harvestRepoVocab({ root: repo });
  assert.ok(!result.words.includes("kubernetesss"), "node_modules must be skipped");
  assert.ok(!result.words.includes("kubernetesssss"), "lockfiles must be skipped");
  assert.ok(result.words.includes("leftpad"));
});

test("maxFiles caps the walk", () => {
  const repo = tmpRepo();
  for (let i = 0; i < 10; i++) write(repo, `f${i}.ts`, "const zzquux = 1;");
  const result = harvestRepoVocab({ root: repo, maxFiles: 3 });
  assert.equal(result.filesScanned, 3);
});

test("missing or non-directory root yields empty vocab", () => {
  assert.deepEqual(harvestRepoVocab({ root: "/nonexistent/path" }).words, []);
});
