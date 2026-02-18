import * as core from "@actions/core";
import * as github from "@actions/github";
import type { Octokit } from "@octokit/rest";

export interface GitHubContext {
  owner: string;
  repo: string;
  prNumber: number;
  sha: string;
  isPublic: boolean;
}

/**
 * Get GitHub context from Actions environment
 */
export async function getGitHubContext(octokit: Octokit): Promise<GitHubContext | null> {
  const context = github.context;

  // Only run on pull requests
  if (!context.payload.pull_request) {
    core.info("Not a pull request, skipping GitHub integration");
    return null;
  }

  const owner = context.repo.owner;
  const repo = context.repo.repo;
  const prNumber = context.payload.pull_request.number;
  const sha = context.payload.pull_request.head.sha;

  // Check if repo is public
  const { data: repoData } = await octokit.rest.repos.get({
    owner,
    repo,
  });

  const isPublic = !repoData.private;

  return {
    owner,
    repo,
    prNumber,
    sha,
    isPublic,
  };
}

/**
 * Get list of files changed in the PR
 */
export async function getChangedFiles(octokit: Octokit, context: GitHubContext): Promise<string[]> {
  const { owner, repo, prNumber } = context;

  try {
    const { data: files } = await octokit.rest.pulls.listFiles({
      owner,
      repo,
      pull_number: prNumber,
      per_page: 100,
    });

    // Filter for code files (exclude images, binaries, etc)
    const codeExtensions = [
      ".ts",
      ".tsx",
      ".js",
      ".jsx",
      ".py",
      ".java",
      ".go",
      ".rs",
      ".c",
      ".cpp",
      ".cs",
      ".php",
      ".rb",
      ".swift",
      ".kt",
      ".scala",
      ".sql",
    ];

    const changedFiles = files
      .filter((file) => {
        // Only include added or modified files
        if (file.status === "removed") return false;

        // Check if it's a code file
        return codeExtensions.some((ext) => file.filename.endsWith(ext));
      })
      .map((file) => file.filename);

    core.info(`Found ${changedFiles.length} changed code files in PR`);
    return changedFiles;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    core.warning(`Failed to get changed files: ${message}`);
    return [];
  }
}

/**
 * Find existing audit comment on the PR
 */
export async function findExistingComment(
  octokit: Octokit,
  context: GitHubContext,
): Promise<number | null> {
  const { owner, repo, prNumber } = context;

  try {
    const { data: comments } = await octokit.rest.issues.listComments({
      owner,
      repo,
      issue_number: prNumber,
    });

    // Find comment that starts with our marker
    const marker = "## 🤖 AI Code Auditor Report";
    const existing = comments.find((comment) => comment.body?.startsWith(marker));

    return existing ? existing.id : null;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    core.warning(`Failed to find existing comment: ${message}`);
    return null;
  }
}

/**
 * Post a new comment to the PR
 */
export async function postPRComment(
  octokit: Octokit,
  context: GitHubContext,
  comment: string,
): Promise<string> {
  const { owner, repo, prNumber } = context;

  try {
    const { data } = await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body: comment,
    });

    core.info(`Posted PR comment: ${data.html_url}`);
    return data.html_url;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    throw new Error(`Failed to post PR comment: ${message}`);
  }
}

/**
 * Update an existing PR comment
 */
export async function updatePRComment(
  octokit: Octokit,
  context: GitHubContext,
  commentId: number,
  comment: string,
): Promise<string> {
  const { owner, repo } = context;

  try {
    const { data } = await octokit.rest.issues.updateComment({
      owner,
      repo,
      comment_id: commentId,
      body: comment,
    });

    core.info(`Updated PR comment: ${data.html_url}`);
    return data.html_url;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    throw new Error(`Failed to update PR comment: ${message}`);
  }
}

/**
 * Post or update PR comment (handles deduplication)
 */
export async function postOrUpdateComment(
  octokit: Octokit,
  context: GitHubContext,
  comment: string,
): Promise<string> {
  // Try to find existing comment
  const existingId = await findExistingComment(octokit, context);

  if (existingId) {
    core.info("Found existing comment, updating...");
    return await updatePRComment(octokit, context, existingId, comment);
  } else {
    core.info("No existing comment found, posting new comment...");
    return await postPRComment(octokit, context, comment);
  }
}

/**
 * Check if repository is public
 */
export async function isPublicRepo(
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<boolean> {
  try {
    const { data } = await octokit.rest.repos.get({ owner, repo });
    return !data.private;
  } catch (error) {
    core.warning(`Failed to check if repo is public, assuming private`);
    return false;
  }
}
