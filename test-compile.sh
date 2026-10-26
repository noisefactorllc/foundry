#!/bin/bash
# Start python server and open browser
set -euo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/public"
echo "Starting server at http://localhost:3456"
echo "Open browser console to see debug output"
python3 -m http.server 3456
