import { spawn } from 'child_process';
import type { ModelCaller, ModelCallerResult } from '@varp/audit';

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

function parseJsonEnvelope(raw: string): ModelCallerResult {
  try {
    const messages = JSON.parse(raw);
    const result = Array.isArray(messages)
      ? messages.find((m: any) => m.type === 'result')
      : messages;

    if (!result) {
      return { text: raw };
    }

    const usage = result.usage
      ? { inputTokens: result.usage.input_tokens ?? 0, outputTokens: result.usage.output_tokens ?? 0 }
      : undefined;

    if (result.structured_output != null) {
      return {
        text: typeof result.structured_output === 'string'
          ? result.structured_output
          : JSON.stringify(result.structured_output),
        structured: result.structured_output,
        usage,
        costUsd: result.total_cost_usd,
      };
    }

    return {
      text: result.result ?? raw,
      usage,
      costUsd: result.total_cost_usd,
    };
  } catch {
    return { text: raw };
  }
}

/**
 * Call Claude via the Claude Code CLI.
 * Implements the ModelCaller interface from @varp/audit.
 */
export const callClaude: ModelCaller = async (systemPrompt, userPrompt, options) => {
  const useStructured = !!options.jsonSchema;

  const args = [
    '-p',
    '--system-prompt', systemPrompt,
    '--model', options.model,
    '--tools', '',
    '--output-format', useStructured ? 'json' : 'text',
    '--no-session-persistence',
  ];

  if (options.jsonSchema) {
    args.push('--json-schema', JSON.stringify(options.jsonSchema));
  }

  args.push(userPrompt);

  const raw = await spawnClaude(args);

  if (!useStructured) {
    return { text: raw };
  }

  return parseJsonEnvelope(raw);
};

/**
 * Test Claude Code CLI connectivity.
 */
export async function testConnection(model: string = 'claude-sonnet-4-5-20250929'): Promise<void> {
  console.log('Testing Claude Code CLI connection...');

  try {
    const result = await callClaude(
      'You are a helpful assistant. Respond concisely.',
      "Say 'Connection successful' and nothing else.",
      { model, maxTokens: 100 }
    );

    console.log('Success!');
    console.log('Response:', result.text);
  } catch (error) {
    console.error('Test failed:');
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
