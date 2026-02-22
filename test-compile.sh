#!/bin/bash
# Start python server and open browser
cd /Users/aayars/source/workspace/public
echo "Starting server at http://localhost:3456"
echo "Open browser console to see debug output"
python3 -m http.server 3456
