import { spawn } from 'child_process';

export interface ApiCallOptions {
  model: string;
  maxTokens?: number;
}

/**
 * Call Claude via the Claude Code CLI.
 *
 * Uses `claude -p` (print mode) with `--system-prompt` and `--tools ""`
 * (no tools — pure text analysis). Auth is handled by Claude Code's own
 * session/token, so no ANTHROPIC_API_KEY needed.
 */
export async function callClaude(
  systemPrompt: string,
  userPrompt: string,
  options: ApiCallOptions
): Promise<string> {
  const args = [
    '-p',
    '--system-prompt', systemPrompt,
    '--model', options.model,
    '--tools', '',
    '--output-format', 'text',
    '--no-session-persistence',
    userPrompt,
  ];

  return spawnClaude(args);
}

/** Env vars needed by the claude CLI. Everything else is excluded. */
const ALLOWED_ENV_KEYS = [
  'HOME', 'USER', 'PATH', 'SHELL', 'TERM', 'LANG', 'LC_ALL',
  'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME',
  'NODE_ENV', 'NO_COLOR',
];

function filteredEnv(): Record<string, string> {
  const env: Record<string, string> = { CLAUDECODE: '' };
  for (const key of ALLOWED_ENV_KEYS) {
    if (process.env[key]) env[key] = process.env[key]!;
  }
  return env;
}

/**
 * Spawn claude CLI and collect output.
 */
function spawnClaude(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('claude', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: filteredEnv(),
    });

    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];

    proc.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    proc.stderr.on('data', (chunk: Buffer) => errChunks.push(chunk));

    proc.on('close', (code) => {
      const stdout = Buffer.concat(chunks).toString('utf-8').trim();

      if (code !== 0) {
        reject(new Error(`Claude CLI exited with code ${code}`));
        return;
      }

      if (!stdout) {
        reject(new Error('No output from Claude CLI'));
        return;
      }

      resolve(stdout);
    });

    proc.on('error', (err) => {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(new Error(
          'claude CLI not found. Install it with: npm install -g @anthropic-ai/claude-code'
        ));
      } else {
        reject(new Error('Failed to spawn Claude CLI'));
      }
    });
  });
}

/**
 * Simple test function to verify Claude Code CLI connectivity.
 */
export async function testConnection(model: string = 'claude-sonnet-4-5-20250929'): Promise<void> {
  console.log('Testing Claude Code CLI connection...');

  try {
    const response = await callClaude(
      'You are a helpful assistant. Respond concisely.',
      "Say 'Connection successful' and nothing else.",
      { model, maxTokens: 100 }
    );

    console.log('✓ Success!');
    console.log('Response:', response);
  } catch (error) {
    console.error('✗ Test failed:');
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (import.meta.main) {
  testConnection();
}
