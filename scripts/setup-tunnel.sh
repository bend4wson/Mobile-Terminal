#!/bin/bash
set -e

echo "================================="
echo "  Terminal Mobile — Tunnel Setup"
echo "================================="
echo ""

# 1. Check prerequisites
echo "Checking prerequisites..."

if ! command -v node &> /dev/null; then
  echo "ERROR: Node.js is not installed. Please install Node.js >= 18."
  exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  echo "ERROR: Node.js >= 18 is required. Found: $(node -v)"
  exit 1
fi
echo "  Node.js $(node -v) — OK"

# 2. Install cloudflared
if ! command -v cloudflared &> /dev/null; then
  echo ""
  echo "cloudflared is not installed."

  OS=$(uname -s)
  ARCH=$(uname -m)

  case "$OS" in
    Darwin)
      if command -v brew &> /dev/null; then
        echo "Installing via Homebrew..."
        brew install cloudflared
      else
        echo "Please install Homebrew first, then run: brew install cloudflared"
        echo "Or download from: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
        exit 1
      fi
      ;;
    Linux)
      if command -v apt-get &> /dev/null; then
        echo "Installing via apt..."
        curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg > /dev/null
        echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/cloudflared.list
        sudo apt-get update && sudo apt-get install -y cloudflared
      else
        echo "Downloading cloudflared binary..."
        case "$ARCH" in
          x86_64) ARCH_NAME="amd64" ;;
          aarch64|arm64) ARCH_NAME="arm64" ;;
          *) echo "Unsupported architecture: $ARCH"; exit 1 ;;
        esac
        curl -fsSL -o /tmp/cloudflared "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${ARCH_NAME}"
        chmod +x /tmp/cloudflared
        sudo mv /tmp/cloudflared /usr/local/bin/cloudflared
      fi
      ;;
    *)
      echo "Unsupported OS: $OS"
      echo "Download cloudflared from: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
      exit 1
      ;;
  esac
fi

echo "  cloudflared $(cloudflared --version 2>&1 | head -1) — OK"

# 3. Authenticate
echo ""
echo "Step 1: Authenticate with Cloudflare"
echo "A browser window will open. Log in and authorize cloudflared."
echo ""
read -p "Press Enter to continue..."
cloudflared login

# 4. Create tunnel
echo ""
echo "Step 2: Create tunnel"
TUNNEL_NAME="terminal-mobile"

if cloudflared tunnel list | grep -q "$TUNNEL_NAME"; then
  echo "  Tunnel '$TUNNEL_NAME' already exists."
else
  cloudflared tunnel create "$TUNNEL_NAME"
  echo "  Tunnel '$TUNNEL_NAME' created."
fi

# 5. Configure routing
echo ""
echo "Step 3: Configure domain"
read -p "Enter your domain (e.g., terminal.example.com): " DOMAIN

if [ -z "$DOMAIN" ]; then
  echo "ERROR: Domain is required."
  exit 1
fi

TUNNEL_ID=$(cloudflared tunnel list | grep "$TUNNEL_NAME" | awk '{print $1}')
CRED_FILE="$HOME/.cloudflared/${TUNNEL_ID}.json"

CONFIG_DIR="$HOME/.cloudflared"
CONFIG_FILE="$CONFIG_DIR/config.yml"

cat > "$CONFIG_FILE" << EOF
tunnel: $TUNNEL_ID
credentials-file: $CRED_FILE

ingress:
  - hostname: $DOMAIN
    service: http://localhost:3000
  - service: http_status:404
EOF

echo "  Config written to $CONFIG_FILE"

# 6. DNS routing
echo ""
echo "Step 4: Set up DNS"
cloudflared tunnel route dns "$TUNNEL_NAME" "$DOMAIN" || echo "  DNS route may already exist."
echo "  DNS configured for $DOMAIN"

# 7. Optional: install as service
echo ""
read -p "Install cloudflared as a system service? (y/N): " INSTALL_SERVICE

if [ "$INSTALL_SERVICE" = "y" ] || [ "$INSTALL_SERVICE" = "Y" ]; then
  sudo cloudflared service install
  echo "  Service installed. cloudflared will start on boot."
  echo "  Run: sudo systemctl start cloudflared (Linux) or: sudo launchctl start com.cloudflare.cloudflared (macOS)"
else
  echo "  Skipped. Run manually with: cloudflared tunnel run $TUNNEL_NAME"
fi

echo ""
echo "================================="
echo "  Setup complete!"
echo ""
echo "  Start the app:"
echo "    NODE_ENV=production JWT_SECRET=your-secret npm start"
echo ""
echo "  Start the tunnel:"
echo "    cloudflared tunnel run $TUNNEL_NAME"
echo ""
echo "  Your app will be at: https://$DOMAIN"
echo "================================="
