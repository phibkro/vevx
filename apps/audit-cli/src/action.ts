#!/usr/bin/env node
/**
 * GitHub Action entry point
 *
 * This file is the main entry point for the GitHub Action.
 * It reads inputs, runs the audit, posts PR comments, and sets outputs.
 */

import * as core from "@actions/core";
import * as github from "@actions/github";
import { existsSync } from "fs";
import { discoverFiles } from "./discovery-node";
import { runAudit } from "./orchestrator";
import { synthesizeReport } from "./report/index";
import {
  getGitHubContext,
  getChangedFiles,
  postOrUpdateComment,
} from "./github/api";
import { formatPRComment, formatErrorComment } from "./github/comment";

async function run() {
  try {
    // Get inputs
    const apiKey = core.getInput("anthropic-api-key", { required: true });
    const githubToken = core.getInput("github-token", { required: true });
    const pathInput = core.getInput("path") || "";
    const model = core.getInput("model") || "claude-sonnet-4-5-20250929";
    const failOnCritical = core.getInput("fail-on-critical") === "true";
    const minScoreStr = core.getInput("min-score") || "0";
    const minScore = parseFloat(minScoreStr);
    const maxFilesStr = core.getInput("max-files") || "50";
    const maxFiles = parseInt(maxFilesStr, 10);

    // Set API key in environment
    process.env.ANTHROPIC_API_KEY = apiKey;

    // Create Octokit client
    const octokit = github.getOctokit(githubToken);

    // Get GitHub context
    const ghContext = await getGitHubContext(octokit);

    if (!ghContext) {
      core.info("Not a pull request, exiting");
      return;
    }

    core.info(
      `Running audit for PR #${ghContext.prNumber} in ${ghContext.owner}/${ghContext.repo}`
    );
    core.info(`Repository is ${ghContext.isPublic ? "public" : "private"}`);

    // Determine which files to audit
    let filesToAudit: string[] = [];

    if (pathInput) {
      // User specified a path
      core.info(`Using user-specified path: ${pathInput}`);

      if (!existsSync(pathInput)) {
        throw new Error(`Path does not exist: ${pathInput}`);
      }

      // Discover files at path
      const discovered = await discoverFiles(pathInput);
      filesToAudit = discovered.map((f) => f.path);
    } else {
      // Get changed files from PR
      core.info("Discovering changed files from PR...");
      const changedFiles = await getChangedFiles(octokit, ghContext);

      // Filter to files that exist (in case of deletions)
      filesToAudit = changedFiles.filter((file) => existsSync(file));

      if (filesToAudit.length === 0) {
        core.warning("No code files changed in this PR");

        // Post a comment saying no files to audit
        const comment = formatErrorComment(
          "No code files were changed in this PR. Nothing to audit."
        );
        await postOrUpdateComment(octokit, ghContext, comment);
        return;
      }

      core.info(`Found ${filesToAudit.length} changed code files`);
    }

    // Limit files to prevent excessive API usage
    if (filesToAudit.length > maxFiles) {
      core.warning(
        `Too many files (${filesToAudit.length}), limiting to ${maxFiles}`
      );
      filesToAudit = filesToAudit.slice(0, maxFiles);
    }

    // Discover file contents
    core.info(`Reading ${filesToAudit.length} files...`);
    const files = await discoverFiles(filesToAudit.join(" "));

    if (files.length === 0) {
      throw new Error("No files found to audit");
    }

    // Run audit
    core.info(`Running audit with model: ${model}`);
    const agentResults = await runAudit(files, {
      model,
      maxTokens: 4096,
    });

    // Synthesize report
    const target = pathInput || `PR #${ghContext.prNumber}`;
    const report = synthesizeReport(target, agentResults);

    core.info(`Audit complete! Score: ${report.overallScore.toFixed(1)}/10`);
    core.info(
      `Findings: ${report.criticalCount} critical, ${report.warningCount} warnings, ${report.infoCount} info`
    );

    // Format PR comment
    const comment = formatPRComment(report, ghContext.isPublic);

    // Post or update PR comment
    const reportUrl = await postOrUpdateComment(octokit, ghContext, comment);

    // Set outputs
    core.setOutput("score", report.overallScore.toFixed(1));
    core.setOutput("critical-count", report.criticalCount.toString());
    core.setOutput("warning-count", report.warningCount.toString());
    core.setOutput("info-count", report.infoCount.toString());
    core.setOutput("report-url", reportUrl);

    // Check fail conditions
    if (failOnCritical && report.criticalCount > 0) {
      core.setFailed(
        `Found ${report.criticalCount} critical issue${report.criticalCount !== 1 ? "s" : ""}`
      );
      return;
    }

    if (report.overallScore < minScore) {
      core.setFailed(
        `Score ${report.overallScore.toFixed(1)} is below minimum ${minScore}`
      );
      return;
    }

    core.info("✅ Audit completed successfully!");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    core.error(`Audit failed: ${message}`);

    // Try to post error comment to PR
    try {
      const githubToken = core.getInput("github-token");
      if (githubToken) {
        const octokit = github.getOctokit(githubToken);
        const ghContext = await getGitHubContext(octokit);

        if (ghContext) {
          const errorComment = formatErrorComment(message);
          await postOrUpdateComment(octokit, ghContext, errorComment);
        }
      }
    } catch (commentError) {
      core.warning("Failed to post error comment to PR");
    }

    core.setFailed(message);
  }
}

run();
