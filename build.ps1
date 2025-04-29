# build.ps1
Write-Host "🛠 Building CCD Tunnel Helper binaries..."

# Step 1: Build with pkg
pkg .

# Step 2: Build Windows Installer
& "C:\Program Files (x86)\NSIS\makensis.exe" installers/windows/installer.nsi

Write-Host "✅ Build complete! Check dist/ and ccd-tunnel-helper-setup.exe"
