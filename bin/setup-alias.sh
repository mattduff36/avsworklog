#!/usr/bin/env bash
# Quick setup script to add fixerrors alias to your bash profile

BASHRC="$HOME/.bashrc"
BASH_PROFILE="$HOME/.bash_profile"
PROJECT_BIN="/d/Websites/avsworklog/bin"

echo "🔧 Setting up 'fixerrors' command..."

# Determine which file to use
if [ -f "$BASH_PROFILE" ]; then
  CONFIG_FILE="$BASH_PROFILE"
elif [ -f "$BASHRC" ]; then
  CONFIG_FILE="$BASHRC"
else
  echo "Creating ~/.bashrc..."
  touch "$BASHRC"
  CONFIG_FILE="$BASHRC"
fi

# Check if alias already exists
if grep -q "alias fixerrors=" "$CONFIG_FILE"; then
  echo "✅ Alias already exists in $CONFIG_FILE"
else
  echo "" >> "$CONFIG_FILE"
  echo "# AVS Worklog Project Commands" >> "$CONFIG_FILE"
  echo "alias fixerrors='$PROJECT_BIN/fixerrors'" >> "$CONFIG_FILE"
  echo "✅ Added alias to $CONFIG_FILE"
fi

echo ""
echo "To activate the alias, run:"
echo "  source $CONFIG_FILE"
echo ""
echo "Or close and reopen your terminal."
echo ""
echo "Then you can type 'fixerrors' from anywhere!"
