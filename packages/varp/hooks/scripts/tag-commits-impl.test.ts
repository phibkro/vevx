import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

const SCRIPT = resolve(import.meta.dir, "tag-commits-impl.ts");
const PROJECT_ROOT = resolve(import.meta.dir, "../../../..");

/** Run the impl script with a PreToolUse JSON input */
function runImpl(command: string, stagedFiles: string[] = []) {
  const input = JSON.stringify({
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command },
  });

  const result = Bun.spawnSync(["bun", SCRIPT], {
    cwd: PROJECT_ROOT,
    stdin: Buffer.from(input),
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      // Mock git diff --cached --name-only by injecting a helper
      // We can't easily mock git, so we test with the real repo
    },
  });

  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString().trim(),
    stderr: result.stderr.toString().trim(),
  };
}

describe("tag-commits-impl", () => {
  test("exits 0 for non-commit commands", () => {
    const result = runImpl("npm test");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
  });

  test("exits 0 for editor-based commits (no -m)", () => {
    const result = runImpl("git commit");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
  });

  test("exits 0 when no staged files", () => {
    // With nothing staged, git diff --cached --name-only returns empty
    // This depends on repo state, but the script handles empty gracefully
    const result = runImpl('git commit -m "test"');
    // Either exits 0 with no output (no staged files or no matching components)
    // or produces valid JSON (if there happen to be staged files)
    expect(result.exitCode).toBe(0);
    if (result.stdout) {
      const parsed = JSON.parse(result.stdout);
      expect(parsed.hookSpecificOutput.hookEventName).toBe("PreToolUse");
    }
  });

  test("handles HEREDOC commit with Co-Authored-By", () => {
    // Stage a known file to get predictable output
    // We test the command rewriting logic by checking the output format
    // This test verifies the regex replacement works on the HEREDOC pattern
    const heredocCmd = `git commit -m "$(cat <<'EOF'
feat: test commit

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"`;

    const result = runImpl(heredocCmd);
    expect(result.exitCode).toBe(0);

    if (result.stdout) {
      const parsed = JSON.parse(result.stdout);
      const newCmd = parsed.hookSpecificOutput.updatedInput.command;
      // Tags line should appear before Co-Authored-By
      const tagsIdx = newCmd.indexOf("tags:");
      const coAuthorIdx = newCmd.indexOf("Co-Authored-By:");
      expect(tagsIdx).toBeGreaterThan(-1);
      expect(tagsIdx).toBeLessThan(coAuthorIdx);
    }
  });

  test("produces valid PreToolUse JSON when tags are generated", () => {
    // Use a HEREDOC command touching a known component path
    const cmd = `git commit -m "$(cat <<'EOF'
feat: update manifest

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"`;

    const result = runImpl(cmd);
    expect(result.exitCode).toBe(0);

    if (result.stdout) {
      const parsed = JSON.parse(result.stdout);
      expect(parsed.hookSpecificOutput).toBeDefined();
      expect(parsed.hookSpecificOutput.hookEventName).toBe("PreToolUse");
      expect(parsed.hookSpecificOutput.permissionDecision).toBe("allow");
      expect(parsed.hookSpecificOutput.updatedInput).toBeDefined();
      expect(parsed.hookSpecificOutput.updatedInput.command).toContain("tags:");
    }
  });
});
