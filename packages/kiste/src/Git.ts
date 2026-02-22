import { Context, Effect, Layer } from "effect";

import { GitError } from "./Errors.js";

// ---------------------------------------------------------------------------
// RawCommit
// ---------------------------------------------------------------------------

export interface RawCommit {
  readonly sha: string;
  readonly author: string;
  readonly timestamp: number;
  readonly subject: string;
  readonly body: string;
  readonly files: readonly string[];
  readonly deletedFiles: readonly string[];
}

// ---------------------------------------------------------------------------
// Git service tag
// ---------------------------------------------------------------------------

export class Git extends Context.Tag("kiste/Git")<
  Git,
  {
    readonly revParse: (cwd: string, ref?: string) => Effect.Effect<string, GitError>;
    readonly log: (cwd: string, since?: string) => Effect.Effect<readonly RawCommit[], GitError>;
    readonly show: (cwd: string, ref: string, path: string) => Effect.Effect<string, GitError>;
  }
>() {}

// ---------------------------------------------------------------------------
// parseGitLogOutput — pure parser
// ---------------------------------------------------------------------------

const COMMIT_DELIM = "---KISTE-COMMIT---";
const FILES_DELIM = "---KISTE-FILES---";

export function parseGitLogOutput(raw: string): RawCommit[] {
  if (raw.trim() === "") return [];

  const blocks = raw.split(COMMIT_DELIM).filter((b) => b.trim().length > 0);
  const commits: RawCommit[] = [];

  for (const block of blocks) {
    const [metaPart, filesPart] = block.split(FILES_DELIM);
    if (!metaPart) continue;

    const lines = metaPart.split("\n");
    // First line is empty (from the newline after the delimiter), skip it
    let i = 0;
    while (i < lines.length && lines[i]!.trim() === "") i++;

    const sha = lines[i++] ?? "";
    const author = lines[i++] ?? "";
    const timestampStr = lines[i++] ?? "0";
    const subject = lines[i++] ?? "";

    // Remaining lines in metaPart are body (may be multi-line)
    const bodyLines: string[] = [];
    for (; i < lines.length; i++) {
      bodyLines.push(lines[i]!);
    }
    // Trim trailing empty lines from body
    while (bodyLines.length > 0 && bodyLines[bodyLines.length - 1]!.trim() === "") {
      bodyLines.pop();
    }
    const body = bodyLines.join("\n");

    // Parse name-status lines from files part
    const files: string[] = [];
    const deletedFiles: string[] = [];

    if (filesPart) {
      for (const fline of filesPart.split("\n")) {
        const trimmed = fline.trim();
        if (trimmed === "") continue;
        // Format: "M\tpath" or "A\tpath" or "D\tpath" or "R100\told\tnew"
        const parts = trimmed.split("\t");
        const status = parts[0] ?? "";
        const filePath = parts[1] ?? "";
        if (!filePath) continue;

        if (status === "D") {
          deletedFiles.push(filePath);
        } else if (status.startsWith("R")) {
          // Rename: old file is deleted, new file is added
          const newPath = parts[2] ?? "";
          deletedFiles.push(filePath);
          if (newPath) files.push(newPath);
        } else {
          files.push(filePath);
        }
      }
    }

    commits.push({
      sha: sha.trim(),
      author: author.trim(),
      timestamp: Number(timestampStr.trim()),
      subject: subject.trim(),
      body,
      files,
      deletedFiles,
    });
  }

  return commits;
}

// ---------------------------------------------------------------------------
// GIT_LOG_FORMAT — shared between GitLive and tests
// ---------------------------------------------------------------------------

const GIT_LOG_FORMAT = `${COMMIT_DELIM}%n%H%n%an%n%at%n%s%n%b%n${FILES_DELIM}`;

// ---------------------------------------------------------------------------
// GitLive — uses Bun.spawnSync for phase 0 simplicity
//
// The @effect/platform Command API requires CommandExecutor in the Effect
// environment, which conflicts with the service interface that returns
// Effect<..., GitError> (no R). Using Bun.spawnSync wrapped in Effect.try
// keeps the interface clean and avoids leaking platform requirements.
// ---------------------------------------------------------------------------

function runGit(cwd: string, args: string[]): Effect.Effect<string, GitError> {
  return Effect.try({
    try: () => {
      const result = Bun.spawnSync(["git", ...args], {
        cwd,
        stdout: "pipe",
        stderr: "pipe",
      });
      const stderr = result.stderr.toString().trim();
      if (result.exitCode !== 0) {
        throw { exitCode: result.exitCode, stderr };
      }
      return result.stdout.toString();
    },
    catch: (err) => {
      const e = err as { exitCode?: number; stderr?: string };
      return new GitError({
        command: `git ${args.join(" ")}`,
        stderr: e.stderr ?? String(err),
        exitCode: e.exitCode,
      });
    },
  });
}

export const GitLive: Layer.Layer<Git> = Layer.succeed(Git, {
  revParse: (cwd, ref = "HEAD") =>
    runGit(cwd, ["rev-parse", ref]).pipe(Effect.map((s) => s.trim())),

  log: (cwd, since) => {
    const args = ["log", `--pretty=format:${GIT_LOG_FORMAT}`, "--name-status"];
    if (since) args.push(`${since}..HEAD`);
    return runGit(cwd, args).pipe(Effect.map((output) => parseGitLogOutput(output).reverse()));
  },

  show: (cwd, ref, path) => {
    // Reject shell metacharacters and path traversal in ref/path
    const badPattern = /[;&|`$(){}[\]!<>\\]/;
    if (badPattern.test(ref) || badPattern.test(path)) {
      return Effect.fail(
        new GitError({
          command: `git show ${ref}:${path}`,
          stderr: "Invalid characters in ref or path",
          exitCode: 1,
        }),
      );
    }
    if (path.includes("..")) {
      return Effect.fail(
        new GitError({
          command: `git show ${ref}:${path}`,
          stderr: "Path traversal not allowed",
          exitCode: 1,
        }),
      );
    }
    return runGit(cwd, ["show", `${ref}:${path}`]);
  },
});
