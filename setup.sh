#!/bin/bash
# Install dependencies for ATEM Audio Router
echo "Installing server dependencies..."
cd "$(dirname "$0")/atem-audio-router" && npm install

echo ""
echo "Installing companion module dependencies..."
cd "$(dirname "$0")/companion-module-atem-audiorouter" && npm install

echo ""
echo "Setup complete! Run the server with:"
echo "  cd atem-audio-router && npm start"
