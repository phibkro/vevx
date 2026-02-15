#!/bin/bash
set -e

# AI Code Auditor - Installation Script
# Downloads and installs the appropriate binary for your platform

VERSION="latest"
INSTALL_DIR="$HOME/.code-auditor/bin"
BINARY_NAME="code-auditor"
BASE_URL="https://github.com/yourusername/ai-code-auditor/releases/download"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

info() {
  echo -e "${GREEN}ℹ${NC} $1"
}

warn() {
  echo -e "${YELLOW}⚠${NC} $1"
}

error() {
  echo -e "${RED}✗${NC} $1"
  exit 1
}

success() {
  echo -e "${GREEN}✓${NC} $1"
}

# Detect OS
detect_os() {
  case "$(uname -s)" in
    Darwin*)
      echo "darwin"
      ;;
    Linux*)
      echo "linux"
      ;;
    *)
      error "Unsupported operating system: $(uname -s)"
      ;;
  esac
}

# Detect architecture
detect_arch() {
  case "$(uname -m)" in
    x86_64|amd64)
      echo "x64"
      ;;
    arm64|aarch64)
      echo "arm64"
      ;;
    *)
      error "Unsupported architecture: $(uname -m)"
      ;;
  esac
}

# Main installation
main() {
  echo ""
  info "AI Code Auditor - Installation"
  echo ""

  # Detect platform
  OS=$(detect_os)
  ARCH=$(detect_arch)
  PLATFORM="${OS}-${ARCH}"

  info "Detected platform: ${PLATFORM}"

  # Set binary name based on platform
  BINARY_FILE="code-auditor-${PLATFORM}"
  DOWNLOAD_URL="${BASE_URL}/${VERSION}/${BINARY_FILE}"

  # Create installation directory
  info "Creating installation directory: ${INSTALL_DIR}"
  mkdir -p "${INSTALL_DIR}"

  # Download binary
  info "Downloading ${BINARY_FILE}..."

  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "${DOWNLOAD_URL}" -o "${INSTALL_DIR}/${BINARY_NAME}" || error "Failed to download binary from ${DOWNLOAD_URL}"
  elif command -v wget >/dev/null 2>&1; then
    wget -q "${DOWNLOAD_URL}" -O "${INSTALL_DIR}/${BINARY_NAME}" || error "Failed to download binary from ${DOWNLOAD_URL}"
  else
    error "Neither curl nor wget found. Please install one of them."
  fi

  # Make binary executable
  chmod +x "${INSTALL_DIR}/${BINARY_NAME}"
  success "Binary installed to: ${INSTALL_DIR}/${BINARY_NAME}"

  # Verify installation
  info "Verifying installation..."
  if "${INSTALL_DIR}/${BINARY_NAME}" --version >/dev/null 2>&1; then
    VERSION_OUTPUT=$("${INSTALL_DIR}/${BINARY_NAME}" --version)
    success "Installation verified: ${VERSION_OUTPUT}"
  else
    error "Installation verification failed"
  fi

  echo ""
  info "Installation complete!"
  echo ""

  # Check if install dir is in PATH
  if [[ ":$PATH:" == *":${INSTALL_DIR}:"* ]]; then
    success "${INSTALL_DIR} is already in your PATH"
    echo ""
    info "You can now run: code-auditor --help"
  else
    warn "${INSTALL_DIR} is not in your PATH"
    echo ""
    echo "Add it to your PATH by adding this line to your shell config:"
    echo ""

    # Detect shell and provide specific instructions
    SHELL_NAME=$(basename "$SHELL")
    case "$SHELL_NAME" in
      bash)
        echo "  echo 'export PATH=\"\$HOME/.code-auditor/bin:\$PATH\"' >> ~/.bashrc"
        echo "  source ~/.bashrc"
        ;;
      zsh)
        echo "  echo 'export PATH=\"\$HOME/.code-auditor/bin:\$PATH\"' >> ~/.zshrc"
        echo "  source ~/.zshrc"
        ;;
      fish)
        echo "  fish_add_path \$HOME/.code-auditor/bin"
        ;;
      *)
        echo "  export PATH=\"\$HOME/.code-auditor/bin:\$PATH\""
        ;;
    esac

    echo ""
    echo "Or run directly: ${INSTALL_DIR}/${BINARY_NAME}"
  fi

  echo ""
  info "Next steps:"
  echo "  1. Set your Anthropic API key: export ANTHROPIC_API_KEY='your-key'"
  echo "  2. (Optional) Login to dashboard: code-auditor login"
  echo "  3. Run your first audit: code-auditor /path/to/code"
  echo ""
}

main
