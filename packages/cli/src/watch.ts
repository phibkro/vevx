import chokidar from "chokidar";

/**
 * Debounce utility to prevent multiple rapid re-runs
 */
function debounce<T extends (...args: any[]) => any>(
  fn: T,
  delay: number,
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  return (...args: Parameters<T>) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      fn(...args);
      timeoutId = null;
    }, delay);
  };
}

/**
 * Watch mode: re-run audit on file changes
 */
export async function watchMode(path: string, onRun: () => Promise<void>): Promise<void> {
  console.log(`\n👀 Watching ${path} for changes...\n`);

  const watcher = chokidar.watch(path, {
    ignored: [
      /(^|[/\\])\../, // Ignore dotfiles
      /node_modules/,
      /dist/,
      /build/,
      /\.git/,
    ],
    persistent: true,
    ignoreInitial: true, // Don't fire events for initial scan
  });

  const debouncedRun = debounce(async () => {
    console.clear();
    console.log(`\n🔄 Change detected, re-running audit...\n`);
    try {
      await onRun();
    } catch (error) {
      console.error("\n❌ Audit failed:", error instanceof Error ? error.message : String(error));
    }
    console.log(`\n👀 Watching for changes... (Ctrl+C to exit)\n`);
  }, 500); // 500ms debounce

  watcher.on("change", () => {
    debouncedRun();
  });

  watcher.on("add", () => {
    debouncedRun();
  });

  watcher.on("unlink", () => {
    debouncedRun();
  });

  watcher.on("error", (error) => {
    console.error("\n❌ Watcher error:", error);
  });

  // Run once immediately
  await onRun();
  console.log(`\n👀 Watching for changes... (Ctrl+C to exit)\n`);

  // Keep process alive
  return new Promise(() => {
    // This promise never resolves, keeping the process running
  });
}
