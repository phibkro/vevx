import type { FileContent } from '../agents/types';
import type { Ruleset, Rule, AuditComponent, AuditTask, AuditPlan } from './types';
import { estimateTokens } from '../chunker';
import {
  loadManifestComponents,
  assignFilesToComponents,
  matchRulesByTags,
  type Manifest,
} from './manifest-adapter';

/**
 * Severity → priority mapping. Lower = higher priority (scanned first).
 */
const SEVERITY_PRIORITY: Record<string, number> = {
  'Critical': 0,
  'High': 1,
  'Medium': 2,
  'Low': 3,
  'Informational': 4,
};

/**
 * Heuristic: does a file likely match a rule's "applies to" tags?
 *
 * Maps rule tags like "API routes", "database access layers" to
 * filename/path patterns that commonly contain that type of code.
 */
const TAG_PATTERNS: Record<string, RegExp[]> = {
  'api routes':          [/route/i, /api\//i, /handler/i, /controller/i, /endpoint/i],
  'http handlers':       [/route/i, /handler/i, /middleware/i, /server/i],
  'graphql resolvers':   [/resolver/i, /graphql/i, /schema/i],
  'rpc handlers':        [/rpc/i, /grpc/i, /proto/i],
  'database':            [/db/i, /database/i, /model/i, /schema/i, /migration/i, /query/i, /repository/i, /prisma/i],
  'database access':     [/db/i, /database/i, /model/i, /repository/i, /dao/i, /query/i],
  'database queries':    [/query/i, /db/i, /repository/i, /dao/i],
  'query builders':      [/query/i, /builder/i],
  'database schemas':    [/schema/i, /model/i, /migration/i, /prisma/i],
  'configuration':       [/config/i, /env/i, /settings/i, /\.env/i],
  'middleware':          [/middleware/i],
  'authentication':      [/auth/i, /login/i, /session/i, /jwt/i, /token/i, /credential/i],
  'file access':         [/upload/i, /download/i, /file/i, /storage/i, /fs/i],
  'file serving':        [/static/i, /serve/i, /upload/i, /download/i],
  'logging':             [/log/i, /logger/i, /monitor/i, /audit/i],
  'error handling':      [/error/i, /exception/i, /handler/i],
  'encryption':          [/crypto/i, /encrypt/i, /hash/i, /cipher/i, /sign/i],
  'template':            [/template/i, /view/i, /render/i, /component/i],
  'admin':               [/admin/i, /dashboard/i, /manage/i],
  'payment':             [/payment/i, /billing/i, /stripe/i, /checkout/i, /subscription/i],
  'webhook':             [/webhook/i, /hook/i, /callback/i],
  'seed data':           [/seed/i, /fixture/i, /mock/i],
  'docker':              [/docker/i, /compose/i, /Dockerfile/i],
  'ci/cd':               [/\.github/i, /ci/i, /workflow/i, /jenkins/i, /gitlab-ci/i, /pipeline/i],
  'package manifests':   [/package\.json/i, /requirements/i, /go\.mod/i, /Cargo\.toml/i, /pom\.xml/i],
  'html rendering':      [/component/i, /page/i, /view/i, /template/i, /\.tsx/i, /\.jsx/i],
  'url fetching':        [/fetch/i, /http/i, /request/i, /client/i, /proxy/i],
};

/**
 * Check if a file path matches any of the "applies to" tags for a rule.
 * Returns true if ANY tag matches, or if the rule has no specific tags.
 */
function fileMatchesRule(filePath: string, rule: Rule): boolean {
  if (rule.appliesTo.length === 0) return true;

  for (const tag of rule.appliesTo) {
    const normalizedTag = tag.toLowerCase().trim();

    // Check against known patterns
    for (const [patternTag, regexps] of Object.entries(TAG_PATTERNS)) {
      if (normalizedTag.includes(patternTag)) {
        if (regexps.some(re => re.test(filePath))) {
          return true;
        }
      }
    }

    // Fallback: check if any word in the tag appears in the file path
    const words = normalizedTag.split(/\s+/);
    if (words.some(word => word.length > 3 && filePath.toLowerCase().includes(word))) {
      return true;
    }
  }

  return false;
}

/**
 * Group files into logical components based on directory structure.
 *
 * Strategy: use top-level directories as component boundaries.
 * Files at the root level are grouped into a "root" component.
 */
export function groupIntoComponents(files: FileContent[]): AuditComponent[] {
  const groups = new Map<string, FileContent[]>();

  for (const file of files) {
    const parts = file.relativePath.split('/');
    // Use first two directory levels as component key, or "root" for top-level files
    let componentKey: string;
    if (parts.length <= 1) {
      componentKey = 'root';
    } else if (parts.length <= 2) {
      componentKey = parts[0];
    } else {
      componentKey = `${parts[0]}/${parts[1]}`;
    }

    const group = groups.get(componentKey) || [];
    group.push(file);
    groups.set(componentKey, group);
  }

  return Array.from(groups.entries()).map(([name, componentFiles]) => ({
    name,
    path: name === 'root' ? '.' : name,
    files: componentFiles.map(f => f.relativePath),
    languages: [...new Set(componentFiles.map(f => f.language))],
    estimatedTokens: componentFiles.reduce(
      (sum, f) => sum + estimateTokens(f.content),
      0
    ),
  }));
}

/**
 * Determine highest severity among a set of rules.
 */
function highestSeverityPriority(rules: Rule[]): number {
  return Math.min(
    ...rules.map(r => SEVERITY_PRIORITY[r.severity] ?? 3)
  );
}

/**
 * Generate a 3-wave audit plan from files and a parsed ruleset.
 *
 * When manifestPath is provided (or a varp.yaml is found in the target directory),
 * uses manifest-defined components and tag-based rule matching instead of
 * heuristic directory grouping and filename pattern matching.
 */
export function generatePlan(
  files: FileContent[],
  ruleset: Ruleset,
  options?: { manifestPath?: string; targetPath?: string },
): AuditPlan {
  // Try manifest-based components first
  let components: AuditComponent[];
  let manifest: Manifest | undefined;
  let useManifest = false;

  const targetPath = options?.targetPath ?? (files[0]?.path ? files[0].path.replace(/\/[^/]+$/, '') : '.');

  const manifestResult = loadManifestComponents(targetPath, options?.manifestPath);
  if (manifestResult) {
    assignFilesToComponents(manifestResult.components, manifestResult.manifest, files, targetPath);
    // Filter out components with no files
    components = manifestResult.components.filter(c => c.files.length > 0);
    manifest = manifestResult.manifest;
    useManifest = true;
  } else {
    components = groupIntoComponents(files);
  }

  let taskId = 0;

  // --- Wave 1: Component scan tasks ---
  const wave1: AuditTask[] = [];

  for (const component of components) {
    // Find which rules are relevant to this component
    const manifestComp = useManifest && manifest ? manifest.components[component.name] : undefined;
    const componentTags = manifestComp?.tags ?? [];

    // Try tag-based matching first, fall through to heuristics if no tags match any rules
    let relevantRules = (useManifest && componentTags.length > 0)
      ? ruleset.rules.filter(rule => matchRulesByTags(componentTags, rule))
      : [];

    if (relevantRules.length === 0) {
      relevantRules = ruleset.rules.filter(rule =>
        component.files.some(filePath => fileMatchesRule(filePath, rule))
      );
    }

    if (relevantRules.length === 0) continue;

    // Group rules by category for manageable task sizes
    const rulesByCategory = new Map<string, Rule[]>();
    for (const rule of relevantRules) {
      const group = rulesByCategory.get(rule.category) || [];
      group.push(rule);
      rulesByCategory.set(rule.category, group);
    }

    for (const [category, categoryRules] of rulesByCategory) {
      const relevantFiles = component.files.filter(filePath =>
        categoryRules.some(rule => fileMatchesRule(filePath, rule))
      );

      if (relevantFiles.length === 0) continue;

      const tokenEstimate = files
        .filter(f => relevantFiles.includes(f.relativePath))
        .reduce((sum, f) => sum + estimateTokens(f.content), 0);

      wave1.push({
        id: `scan-${++taskId}`,
        wave: 1,
        type: 'component-scan',
        component: component.name,
        rules: categoryRules.map(r => r.id),
        files: relevantFiles,
        estimatedTokens: tokenEstimate,
        priority: highestSeverityPriority(categoryRules),
        description: `Scan ${component.name} against ${category} (${categoryRules.map(r => r.id).join(', ')})`,
      });
    }
  }

  // Sort wave 1 by priority (highest severity first)
  wave1.sort((a, b) => a.priority - b.priority);

  // --- Wave 2: Cross-cutting tasks ---
  const wave2: AuditTask[] = [];

  for (const pattern of ruleset.crossCutting) {
    // Cross-cutting tasks may need all files or a targeted subset
    const allFiles = files.map(f => f.relativePath);
    const totalTokens = files.reduce((sum, f) => sum + estimateTokens(f.content), 0);

    wave2.push({
      id: `cross-${++taskId}`,
      wave: 2,
      type: 'cross-cutting',
      rules: [pattern.id, ...pattern.relatesTo],
      files: allFiles,
      estimatedTokens: totalTokens,
      priority: 0, // Cross-cutting is always high priority
      description: `${pattern.title}: ${pattern.objective}`,
    });
  }

  // --- Wave 3: Synthesis ---
  const wave3: AuditTask[] = [{
    id: `synth-${++taskId}`,
    wave: 3,
    type: 'synthesis',
    rules: [],
    files: [],
    estimatedTokens: 0, // Synthesis operates on wave 1+2 outputs, not source files
    priority: 0,
    description: 'Aggregate findings, deduplicate, rank by severity, compute coverage',
  }];

  // --- Stats ---
  const totalTasks = wave1.length + wave2.length + wave3.length;
  const totalRules = ruleset.rules.length + ruleset.crossCutting.length;
  const totalFiles = files.length;
  const estimatedTokens = wave1.reduce((s, t) => s + t.estimatedTokens, 0)
    + wave2.reduce((s, t) => s + t.estimatedTokens, 0);

  return {
    ruleset: ruleset.meta,
    components,
    waves: { wave1, wave2, wave3 },
    stats: { totalTasks, totalRules, totalFiles, estimatedTokens },
  };
}
