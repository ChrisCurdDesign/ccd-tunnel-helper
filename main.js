const { app, Menu, Tray, dialog } = require('electron');
const { spawn } = require('child_process');
const path = require('path');

let tray = null;
let sshProcess = null;

function parseTunnelUrl(url) {
  try {
    const parsed = new URL(url);

    const user = parsed.searchParams.get('user') || 'root';
    const host = parsed.searchParams.get('host') || '127.0.0.1';
    const localPort = parsed.searchParams.get('local_port') || '10000';
    const remotePort = parsed.searchParams.get('remote_port') || localPort;
    const launchUrl = parsed.searchParams.get('launch') || null;

    return { user, host, localPort, remotePort, launchUrl };
  } catch (e) {
    console.error('Failed to parse tunnel URL:', e);
    app.quit();
  }
}

function launchTunnel({ user, host, localPort, remotePort }) {
  const sshArgs = ['-L', `${localPort}:127.0.0.1:${remotePort}`, `${user}@${host}`];
  console.log(`Opening SSH tunnel: ssh ${sshArgs.join(' ')}`);

  sshProcess = spawn('ssh', sshArgs, {
    stdio: 'ignore',
    windowsHide: true,
  });
}

function openLaunchUrl(launchUrl) {
  if (!launchUrl) return;
  console.log(`Opening launch URL: ${launchUrl}`);

  let cmd = '';

  if (process.platform === 'win32') {
    cmd = `start "" "${launchUrl}"`;
  } else if (process.platform === 'darwin') {
    cmd = `open "${launchUrl}"`;
  } else {
    cmd = `xdg-open "${launchUrl}"`;
  }

  spawn(cmd, { shell: true, detached: true });
}

function handleTunnel(url) {
  const tunnelConfig = parseTunnelUrl(url);
  launchTunnel(tunnelConfig);
  openLaunchUrl(tunnelConfig.launchUrl);
  showTray(tunnelConfig.host);
}

function showTray(host) {
  const iconFile = path.join(process.resourcesPath, 'icon.png');

  tray = new Tray(iconFile);
  tray.setToolTip(`Tunnel active to ${host}`);

  const contextMenu = Menu.buildFromTemplate([
    { label: `Tunnel active to ${host}`, enabled: false },
    { type: 'separator' },
    {
      label: 'Disconnect',
      click: () => {
        disconnectTunnel();
      }
    },
  ]);

  tray.setContextMenu(contextMenu);
}

function disconnectTunnel() {
  if (sshProcess && sshProcess.pid) {
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/PID', sshProcess.pid, '/F'], { detached: true });
      } else {
        process.kill(sshProcess.pid, 'SIGTERM');
      }
      console.log('Tunnel disconnected.');
    } catch (err) {
      console.error('Failed to kill SSH process:', err);
    }
  }
  app.quit();
}

// Ensure single instance
const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine) => {
    const url = commandLine.find(arg => arg.startsWith('ccd-tunnel://'));
    if (url) handleTunnel(url);
  });

  app.whenReady().then(() => {
    if (app.isPackaged && !app.isDefaultProtocolClient('ccd-tunnel')) {
      const exePath = process.execPath;
      app.setAsDefaultProtocolClient('ccd-tunnel', exePath, []);
    }

    const args = process.argv.slice(1);
    const tunnelUrl = args.find(arg => arg.startsWith('ccd-tunnel://'));

    if (tunnelUrl) {
      handleTunnel(tunnelUrl);
    } else {
      dialog.showMessageBox({
        type: 'info',
        title: 'CCD Tunnel Helper',
        message: 'CCD Tunnel Helper was successfully installed and is now ready to handle ccd-tunnel:// links.',
      }).then(() => {
        app.quit();
      });
    }
  });
}
