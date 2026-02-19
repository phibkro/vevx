import { existsSync, writeFileSync } from "fs";

import { suggestComponents } from "@varp/core/lib";

const MANIFEST_FILE = "varp.yaml";

function generateYaml(components: Array<{ name: string; path: string[] }>): string {
  let yaml = "varp: 0.1.0\n\ncomponents:\n";

  for (const comp of components) {
    yaml += `  ${comp.name}:\n`;
    if (comp.path.length === 1) {
      yaml += `    path: ${comp.path[0]}\n`;
    } else {
      yaml += `    path:\n`;
      for (const p of comp.path) {
        yaml += `      - ${p}\n`;
      }
    }
  }

  return yaml;
}

function generateTemplate(): string {
  return `varp: 0.1.0

components:
  # example:
  #   path: src/example
  #   deps: []
`;
}

export async function runInitCommand(): Promise<void> {
  if (existsSync(MANIFEST_FILE)) {
    throw new Error(`${MANIFEST_FILE} already exists. Remove it first to re-initialize.`);
  }

  const result = suggestComponents(process.cwd());
  let yaml: string;
  let componentCount: number;

  if (result.components.length > 0) {
    yaml = generateYaml(result.components);
    componentCount = result.components.length;
  } else {
    yaml = generateTemplate();
    componentCount = 0;
  }

  writeFileSync(MANIFEST_FILE, yaml, "utf-8");

  if (componentCount > 0) {
    console.error(`Created ${MANIFEST_FILE} with ${componentCount} components.`);
  } else {
    console.error(`Created ${MANIFEST_FILE} with template. Edit it to add your components.`);
  }

  console.error(`
Optional fields you can add to each component:
  deps: [shared]               # component dependencies
  tags: [core, api]            # semantic grouping — view with: varp graph --tags
  stability: stable            # stable | active | experimental
  test: "bun test src/auth"    # custom test command
  env: [DATABASE_URL]          # required environment variables

Run 'varp lint' to check health, 'varp graph' to visualize.`);
}
