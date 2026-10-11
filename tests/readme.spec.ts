import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";

// The README must keep up with the code: a key, command, option, `$` call or image added without it fails here.
// String paths, not URLs: the engine's URL type is not the one node:fs takes.
const root = `${import.meta.dirname}/..`;
const read = (p: string): string => readFileSync(`${root}/${p}`, "utf8");
const readme = read("README.md");
const code = ["hooks/panel.ts", "hooks/gsd-status.ts"].map(read).join("\n");
const plugin = JSON.parse(read(".claude-plugin/plugin.json")) as { name: string; version: string; description: string; userConfig: Record<string, { default: unknown }> };
const market = JSON.parse(read(".claude-plugin/marketplace.json")) as { name: string; plugins: { name: string; description: string }[] };

test("README: every hotkey is in the key table", () => {
  for (const k of new Set([...code.matchAll(/hotkey: "(.)"/g)].map((m) => m[1]))) assert.match(readme, new RegExp(`^\\| \`${k}\` \\|`, "m"), k);
  assert.match(readme, /^\| `1`-`6` \|/m);
});

test("README: every command and option, with its default", () => {
  for (const [, c] of code.matchAll(/command: "([\w-]+)"/g)) assert.ok(readme.includes(`| \`/${c}\` |`), c);
  for (const [k, v] of Object.entries(plugin.userConfig)) assert.match(readme, new RegExp(`^\\| \`${k}\` \\|.*\\| \`${String(v.default)}\` \\|$`, "m"), k);
});

test("README: every $ call the code makes is in the reach section", () => {
  const at = readme.indexOf("What it can touch (reach)\n");
  assert.ok(at > 0, "reach section");
  const reach = readme.slice(at);
  for (const c of new Set([...code.matchAll(/\$\.(\w+\.\w+)\(/g)].map((m) => m[1]))) assert.ok(reach.includes(`$.${c}`), c);
});

test("README: images exist and every screenshot is used", () => {
  const used = [...readme.matchAll(/(?:\]\(|src=")(docs\/screenshots\/[^)"]+)/g)].map((m) => m[1]);
  for (const p of used) assert.ok(existsSync(`${root}/${p}`), p);
  for (const f of readdirSync(`${root}/docs/screenshots`)) assert.ok(used.includes(`docs/screenshots/${f}`), f);
});

test("versions and names agree: plugin, marketplace, changelog, install commands", () => {
  assert.ok(readme.includes(`badge/version-${plugin.version}-`), "version badge");
  assert.equal(read("CHANGELOG.md").match(/^## (\d+\.\d+\.\d+) \(\d{4}-\d\d-\d\d\)$/m)?.[1], plugin.version);
  const m = market.plugins.find((x) => x.name === plugin.name);
  assert.ok(m, "plugin listed in the marketplace");
  assert.equal(m.description, plugin.description);
  const id = `${plugin.name}@${market.name}`;
  assert.ok(readme.includes(`claude plugin install ${id}`));
  for (const [, x] of readme.matchAll(/gsd-status-mod@([\w-]+)/g)) assert.equal(x, market.name);
});
