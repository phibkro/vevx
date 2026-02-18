/**
 * Generate shell completion scripts for bash and zsh
 */

export function generateBashCompletions(): string {
  return `# code-audit bash completions
_code_audit_completions() {
  local cur prev opts
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"

  # Subcommands
  if [[ \${COMP_CWORD} -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "login logout completions" -- \${cur}) )
    return 0
  fi

  # Options
  opts="--output --format --model --max-tokens --no-parallel --watch --quiet --verbose --debug --version --help"

  case "\${prev}" in
    --format)
      COMPREPLY=( $(compgen -W "text json markdown html" -- \${cur}) )
      return 0
      ;;
    --model)
      COMPREPLY=( $(compgen -W "claude-sonnet-4-5-20250929 claude-opus-4-6" -- \${cur}) )
      return 0
      ;;
    --output|--max-tokens)
      # No completion for these
      return 0
      ;;
  esac

  if [[ \${cur} == -* ]]; then
    COMPREPLY=( $(compgen -W "\${opts}" -- \${cur}) )
    return 0
  fi

  # File/directory completion
  COMPREPLY=( $(compgen -d -- \${cur}) )
}

complete -F _code_audit_completions code-audit
`;
}

export function generateZshCompletions(): string {
  return `#compdef code-audit

_code_audit() {
  local -a commands
  commands=(
    'login:Save API key for dashboard syncing'
    'logout:Remove saved API key'
    'completions:Generate shell completion script'
  )

  local -a options
  options=(
    '--output[Write report to file]:file:_files'
    '--format[Output format]:format:(text json markdown html)'
    '--model[Claude model to use]:model:(claude-sonnet-4-5-20250929 claude-opus-4-6)'
    '--max-tokens[Maximum tokens per chunk]:number:'
    '--no-parallel[Disable parallel processing]'
    '--watch[Watch mode - re-run on file changes]'
    '--quiet[Minimal output]'
    '--verbose[Detailed output]'
    '--debug[Debug output]'
    '(-v --version)'{-v,--version}'[Show version number]'
    '(-h --help)'{-h,--help}'[Show help message]'
  )

  _arguments -C \
    "1: :->command" \
    "*::arg:->args"

  case $state in
    command)
      _describe -t commands 'code-audit commands' commands
      _files -/
      ;;
    args)
      case $words[1] in
        login|logout|completions)
          # No additional arguments
          ;;
        *)
          _arguments $options
          ;;
      esac
      ;;
  esac
}

_code_audit "$@"
`;
}

export function generateCompletions(shell: "bash" | "zsh" = "bash"): string {
  if (shell === "zsh") {
    return generateZshCompletions();
  }
  return generateBashCompletions();
}
