Write-Host "🛠 Building unified CCD Tunnel Helper app..."

# Step 1: Install dependencies
npm install

# Step 2: Build app using electron-builder
npm run build

Write-Host "✅ Build complete! Check dist/ for output files."
