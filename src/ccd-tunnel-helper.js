#!/usr/bin/env node

const { spawn, exec } = require('child_process');

function parseTunnelUrl(uri) {
  const parsed = new URL(uri);

  const user = parsed.searchParams.get('user') || 'root';
  const host = parsed.searchParams.get('host') || '127.0.0.1';
  const localPort = parsed.searchParams.get('local_port') || '10000';
  const remotePort = parsed.searchParams.get('remote_port') || localPort;
  const launchUrl = parsed.searchParams.get('launch') || null;

  return { user, host, localPort, remotePort, launchUrl };
}

function launchTunnel({ user, host, localPort, remotePort }) {
  const sshArgs = ['-L', `${localPort}:127.0.0.1:${remotePort}`, `${user}@${host}`];

  console.log(`Opening SSH tunnel: ssh ${sshArgs.join(' ')}`);

  const ssh = spawn('ssh', sshArgs, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });

  ssh.unref();
}

function openLaunchUrl(launchUrl) {
  if (!launchUrl) return;
  console.log(`Opening launch URL: ${launchUrl}`);

  // Windows: use "start", macOS: "open", Linux: "xdg-open"
  const platform = process.platform;
  let cmd;

  if (platform === 'win32') {
    cmd = `start "" "${launchUrl}"`;
  } else if (platform === 'darwin') {
    cmd = `open "${launchUrl}"`;
  } else {
    cmd = `xdg-open "${launchUrl}"`;
  }

  exec(cmd, { windowsHide: true });
}

// MAIN
const inputUrl = process.argv[2];

if (!inputUrl || !inputUrl.startsWith('ccd-tunnel://')) {
  console.error('Usage: ccd-tunnel-helper <ccd-tunnel://...>');
  process.exit(1);
}

const tunnelConfig = parseTunnelUrl(inputUrl);
launchTunnel(tunnelConfig);
openLaunchUrl(tunnelConfig.launchUrl);
