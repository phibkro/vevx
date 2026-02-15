import { readFileSync, statSync } from "fs";
import { resolve, relative, join } from "path";
import { glob } from "glob";

export interface FileContent {
  path: string;
  relativePath: string;
  language: string;
  content: string;
  size: number;
}

const LANGUAGE_MAP: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".py": "python",
  ".go": "go",
  ".java": "java",
  ".rs": "rust",
  ".c": "c",
  ".cpp": "cpp",
  ".h": "c",
  ".hpp": "cpp",
};

const SUPPORTED_EXTENSIONS = Object.keys(LANGUAGE_MAP);

/**
 * Parse .gitignore file and return patterns to ignore
 */
function parseGitignore(basePath: string): string[] {
  const patterns: string[] = [
    "node_modules",
    ".git",
    "dist",
    "build",
    ".DS_Store",
    "*.min.js",
    "*.bundle.js",
  ];

  try {
    const gitignorePath = join(basePath, ".gitignore");
    const content = readFileSync(gitignorePath, "utf-8");

    content.split("\n").forEach((line) => {
      const trimmed = line.trim();
      // Skip empty lines and comments
      if (trimmed && !trimmed.startsWith("#")) {
        patterns.push(trimmed);
      }
    });
  } catch (error) {
    // .gitignore is optional
  }

  return patterns;
}

/**
 * Check if a path should be ignored based on gitignore patterns
 */
function shouldIgnore(path: string, ignorePatterns: string[]): boolean {
  const normalizedPath = path.replace(/\\/g, "/");

  for (const pattern of ignorePatterns) {
    // Simple pattern matching - handle basic cases
    if (pattern.endsWith("/")) {
      // Directory pattern
      const dirPattern = pattern.slice(0, -1);
      if (
        normalizedPath.includes(`/${dirPattern}/`) ||
        normalizedPath.includes(`${dirPattern}/`)
      ) {
        return true;
      }
    } else if (pattern.startsWith("*")) {
      // Wildcard pattern
      const suffix = pattern.slice(1);
      if (normalizedPath.endsWith(suffix)) {
        return true;
      }
    } else {
      // Exact or contains match
      if (normalizedPath.includes(pattern)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Detect language from file extension
 */
function detectLanguage(filePath: string): string | null {
  const ext = filePath.substring(filePath.lastIndexOf(".")).toLowerCase();
  return LANGUAGE_MAP[ext] || null;
}

/**
 * Check if file is likely binary
 */
function isBinaryFile(filePath: string, sampleSize: number = 512): boolean {
  try {
    const buffer = Buffer.alloc(sampleSize);
    const content = readFileSync(filePath, { encoding: "binary" });
    const sample = content.substring(0, sampleSize);

    // Simple heuristic: if file contains null bytes, it's likely binary
    return sample.includes("\0");
  } catch {
    return false;
  }
}

/**
 * Discover all code files in the given path (file or directory)
 */
export async function discoverFiles(
  targetPath: string
): Promise<FileContent[]> {
  const absolutePath = resolve(targetPath);
  const files: FileContent[] = [];

  try {
    const stat = statSync(absolutePath);

    if (stat.isFile()) {
      // Single file
      const language = detectLanguage(absolutePath);
      if (!language) {
        throw new Error(
          `Unsupported file type: ${absolutePath}\nSupported extensions: ${SUPPORTED_EXTENSIONS.join(", ")}`
        );
      }

      if (isBinaryFile(absolutePath)) {
        throw new Error(`File appears to be binary: ${absolutePath}`);
      }

      const content = readFileSync(absolutePath, "utf-8");
      files.push({
        path: absolutePath,
        relativePath: relative(process.cwd(), absolutePath),
        language,
        content,
        size: stat.size,
      });

      return files;
    }

    // Directory - discover all code files
    const ignorePatterns = parseGitignore(absolutePath);
    const basePath = absolutePath;

    // Build glob pattern for supported extensions
    const globPattern = `**/*{${SUPPORTED_EXTENSIONS.join(",")}}`;

    // Scan directory using node-glob
    const matches = await glob(globPattern, {
      cwd: basePath,
      absolute: true,
      nodir: true,
    });

    for (const fullPath of matches) {
      const relPath = relative(basePath, fullPath);

      // Skip ignored files
      if (shouldIgnore(relPath, ignorePatterns)) {
        continue;
      }

      // Skip binary files
      if (isBinaryFile(fullPath)) {
        continue;
      }

      const language = detectLanguage(fullPath);
      if (!language) {
        continue;
      }

      try {
        const content = readFileSync(fullPath, "utf-8");
        const stat = statSync(fullPath);

        files.push({
          path: fullPath,
          relativePath: relative(process.cwd(), fullPath),
          language,
          content,
          size: stat.size,
        });
      } catch (error) {
        console.warn(`Warning: Could not read file ${fullPath}: ${error}`);
      }
    }

    if (files.length === 0) {
      throw new Error(
        `No supported code files found in ${absolutePath}\nSupported extensions: ${SUPPORTED_EXTENSIONS.join(", ")}`
      );
    }

    return files;
  } catch (error) {
    if (error instanceof Error && error.message.includes("ENOENT")) {
      throw new Error(`Path not found: ${absolutePath}`);
    }
    throw error;
  }
}
