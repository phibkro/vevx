/**
 * Generate shell completion scripts for bash and zsh
 */

export function generateBashCompletions(): string {
  return `# varp bash completions
_varp_completions() {
  local cur prev opts
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"

  # Subcommands
  if [[ \${COMP_CWORD} -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "init graph lint freshness validate coupling summary conventions completions" -- \${cur}) )
    return 0
  fi

  # Per-command options
  local subcmd="\${COMP_WORDS[1]}"
  case "\${subcmd}" in
    graph)
      opts="--manifest --format --tags --no-tags --no-color --no-stability --direction"
      case "\${prev}" in
        --format) COMPREPLY=( $(compgen -W "ascii mermaid" -- \${cur}) ); return 0 ;;
        --direction) COMPREPLY=( $(compgen -W "TD LR" -- \${cur}) ); return 0 ;;
        --manifest) return 0 ;;
      esac
      ;;
    lint)
      opts="--manifest --format --details --suppress"
      case "\${prev}" in
        --format) COMPREPLY=( $(compgen -W "text json" -- \${cur}) ); return 0 ;;
        --manifest) return 0 ;;
      esac
      ;;
    freshness|coupling)
      opts="--manifest"
      ;;
    summary)
      opts="--manifest --format --json"
      case "\${prev}" in
        --format) COMPREPLY=( $(compgen -W "text json" -- \${cur}) ); return 0 ;;
        --manifest) return 0 ;;
      esac
      ;;
    validate)
      opts="--manifest"
      ;;
    conventions)
      opts="--format"
      case "\${prev}" in
        --format) COMPREPLY=( $(compgen -W "text json" -- \${cur}) ); return 0 ;;
      esac
      ;;
    init)
      return 0
      ;;
    *)
      opts="--version --help"
      ;;
  esac

  if [[ \${cur} == -* ]]; then
    COMPREPLY=( $(compgen -W "\${opts}" -- \${cur}) )
    return 0
  fi

  # File/directory completion
  COMPREPLY=( $(compgen -d -- \${cur}) )
}

complete -F _varp_completions varp
`;
}

export function generateZshCompletions(): string {
  return `#compdef varp

_varp() {
  local -a commands
  commands=(
    'init:Scaffold a varp.yaml manifest'
    'graph:Render dependency graph'
    'lint:Lint manifest for issues'
    'freshness:Check doc freshness'
    'validate:Validate plan against manifest'
    'coupling:Analyze component coupling'
    'summary:Project health digest'
    'conventions:Show component detection conventions'
    'completions:Generate shell completion script'
  )

  _arguments -C \\
    "1: :->command" \\
    "*::arg:->args"

  case $state in
    command)
      _describe -t commands 'varp commands' commands
      ;;
    args)
      case $words[1] in
        graph)
          _arguments \\
            '--manifest[Path to varp.yaml]:file:_files' \\
            '--format[Output format]:format:(ascii mermaid)' \\
            '--tags[Group-by-tag view]' \\
            '--no-tags[Hide tag markers]' \\
            '--no-color[Superscript markers instead of colors]' \\
            '--no-stability[Hide stability badges]' \\
            '--direction[Graph direction]:dir:(TD LR)'
          ;;
        lint)
          _arguments \
            '--manifest[Path to varp.yaml]:file:_files' \
            '--format[Output format]:format:(text json)' \
            '--details[Show all warnings grouped by category]' \
            '--suppress[Suppress current warnings]'
          ;;
        freshness|coupling)
          _arguments '--manifest[Path to varp.yaml]:file:_files'
          ;;
        summary)
          _arguments \\
            '--manifest[Path to varp.yaml]:file:_files' \\
            '--format[Output format]:format:(text json)' \\
            '--json[Shorthand for --format json]'
          ;;
        validate)
          _arguments \\
            '--manifest[Path to varp.yaml]:file:_files' \\
            ':plan file:_files -g "*.xml"'
          ;;
        conventions)
          _arguments '--format[Output format]:format:(text json)'
          ;;
        completions)
          _arguments ':shell:(bash zsh)'
          ;;
        init)
          ;;
      esac
      ;;
  esac
}

_varp "$@"
`;
}

export function generateCompletions(shell: "bash" | "zsh" = "bash"): string {
  if (shell === "zsh") {
    return generateZshCompletions();
  }
  return generateBashCompletions();
}
