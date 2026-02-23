/**
 * tag-commits-impl.ts — manifest lookup for tag-commits.sh
 *
 * Reads PreToolUse JSON from stdin, maps staged files to varp.yaml
 * components, and outputs updatedInput with tags: line appended.
 *
 * Requires: bun, built @vevx/varp (packages/varp/build/lib.js)
 */
import { resolve } from "node:path";

import {
  buildComponentPaths,
  findOwningComponent,
  parseManifest,
} from "../../build/lib.js";

const input = JSON.parse(await Bun.stdin.text());
const command: string = input.tool_input?.command ?? "";

// Must be git commit -m (not editor-based)
if (!command.includes("git commit") || !command.includes("-m")) {
  process.exit(0);
}

// Get staged files
const result = Bun.spawnSync(["git", "diff", "--cached", "--name-only"], {
  stdout: "pipe",
  stderr: "pipe",
});
const stagedFiles = result.stdout
  .toString()
  .trim()
  .split("\n")
  .filter(Boolean);

if (stagedFiles.length === 0) process.exit(0);

// Parse manifest and map files to components
const manifestPath = resolve("varp.yaml");
const manifest = parseManifest(manifestPath);
const paths = buildComponentPaths(manifest);

const components = new Set<string>();
for (const file of stagedFiles) {
  const owner = findOwningComponent(resolve(file), manifest, paths);
  if (owner) components.add(owner);
}

if (components.size === 0) process.exit(0);

const tagsLine = `tags: ${[...components].sort().join(", ")}`;

// Rewrite command: insert tags line before Co-Authored-By (convention)
// or before EOF (HEREDOC pattern), whichever is found
let newCommand: string;
if (command.includes("Co-Authored-By:")) {
  // Insert before Co-Authored-By with matching indentation
  newCommand = command.replace(
    /(\n?([ \t]*)Co-Authored-By:)/,
    `\n$2${tagsLine}\n$1`,
  );
} else if (command.includes("EOF")) {
  // HEREDOC without Co-Authored-By: insert before closing EOF
  newCommand = command.replace(
    /(\n?([ \t]*)EOF)/,
    `\n$2${tagsLine}\n$1`,
  );
} else {
  // Simple -m "message" without HEREDOC — too fragile to rewrite safely
  process.exit(0);
}

// Output PreToolUse decision with modified command
console.log(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      updatedInput: {
        ...input.tool_input,
        command: newCommand,
      },
    },
  }),
);
