#!/bin/bash
# CIMS Quick Start Script

echo "🔧 CIMS — Component Inventory Management System"
echo "================================================"

# Check Node.js
if ! command -v node &> /dev/null; then
  echo "❌ Node.js not found. Install from https://nodejs.org"
  exit 1
fi
echo "✅ Node.js $(node -v)"

# Install backend
echo ""
echo "📦 Installing backend dependencies..."
cd "$(dirname "$0")/backend"
npm install

# Install frontend
echo ""
echo "📦 Installing frontend dependencies..."
cd ../frontend
npm install

# Build frontend
echo ""
echo "🏗️  Building frontend..."
npm run build

# Start backend
echo ""
echo "🚀 Starting CIMS server..."
cd ../backend
node server.js
