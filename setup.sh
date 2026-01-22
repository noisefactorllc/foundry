#!/bin/bash

# HADES Setup Script
# Copies required resources from shade/

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SHADE_DIR="$SCRIPT_DIR/../shade"

echo "Setting up HADES..."

# Check if shade directory exists
if [ ! -d "$SHADE_DIR" ]; then
    echo "Error: shade/ directory not found at $SHADE_DIR"
    echo "Make sure shade/ is in the same parent directory as hades/"
    exit 1
fi

# Create directories
mkdir -p "$SCRIPT_DIR/public/js/noisemaker/vendor/effects"
mkdir -p "$SCRIPT_DIR/public/fonts"
mkdir -p "$SCRIPT_DIR/public/img"

echo "Copying files from shade/..."

# Noisemaker vendor files (large JS bundles)
echo "  Copying noisemaker vendor files..."
cp "$SHADE_DIR/public/js/noisemaker/vendor/noisemaker-shaders-core.esm.js" "$SCRIPT_DIR/public/js/noisemaker/vendor/"
cp "$SHADE_DIR/public/js/noisemaker/vendor/noisemaker-shaders-core.esm.min.js" "$SCRIPT_DIR/public/js/noisemaker/vendor/"
cp "$SHADE_DIR/public/js/noisemaker/vendor/effects/manifest.json" "$SCRIPT_DIR/public/js/noisemaker/vendor/effects/"
cp -R "$SHADE_DIR/public/js/noisemaker/vendor/effects/classicNoisedeck" "$SCRIPT_DIR/public/js/noisemaker/vendor/effects/"
cp -R "$SHADE_DIR/public/js/noisemaker/vendor/effects/classicNoisemaker" "$SCRIPT_DIR/public/js/noisemaker/vendor/effects/"
cp -R "$SHADE_DIR/public/js/noisemaker/vendor/effects/filter" "$SCRIPT_DIR/public/js/noisemaker/vendor/effects/"
cp -R "$SHADE_DIR/public/js/noisemaker/vendor/effects/filter3d" "$SCRIPT_DIR/public/js/noisemaker/vendor/effects/"
cp -R "$SHADE_DIR/public/js/noisemaker/vendor/effects/mixer" "$SCRIPT_DIR/public/js/noisemaker/vendor/effects/"
cp -R "$SHADE_DIR/public/js/noisemaker/vendor/effects/points" "$SCRIPT_DIR/public/js/noisemaker/vendor/effects/"
cp -R "$SHADE_DIR/public/js/noisemaker/vendor/effects/render" "$SCRIPT_DIR/public/js/noisemaker/vendor/effects/"
cp -R "$SHADE_DIR/public/js/noisemaker/vendor/effects/synth" "$SCRIPT_DIR/public/js/noisemaker/vendor/effects/"
cp -R "$SHADE_DIR/public/js/noisemaker/vendor/effects/synth3d" "$SCRIPT_DIR/public/js/noisemaker/vendor/effects/"
echo "  ✓ noisemaker/vendor"

# Fonts
echo "  Copying fonts..."
cp "$SHADE_DIR/public/fonts/"*.woff2 "$SCRIPT_DIR/public/fonts/"
echo "  ✓ fonts"

# Images (logo)
echo "  Copying images..."
cp "$SHADE_DIR/public/img/logo.png" "$SCRIPT_DIR/public/img/"
echo "  ✓ img"

echo ""
echo "Setup complete! Run 'npm install && npm start' to launch HADES."
