const { app, Menu, Tray, dialog, Notification } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const net = require('net');
const packageJson = require('./package.json');

let tray = null;
const tunnels = new Map(); // key: `${host}:${localPort}`, value: { sshProcess, launchUrl }
const enableLogging = !app.isPackaged || packageJson.enableLogging === true;

function showNotification(title, body) {
  if (Notification.isSupported()) {
    const icon = path.join(app.isPackaged ? process.resourcesPath : __dirname, 'icon.png');
    new Notification({ title, body, icon }).show();
  }
}

function log(message) {
  if (!enableLogging) return;

  const logPath = path.join(app.getPath('home'), 'ccd-tunnel-helper.log');
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;
  try {
    fs.appendFileSync(logPath, logMessage);
  } catch (err) {
    // If we can't write to the log, strictly speaking we are flying blind,
    // but we can't do much else.
  }
}

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
    log(`Failed to parse tunnel URL: ${e.message}`);
    console.error('Failed to parse tunnel URL:', e);
    app.quit();
  }
}

function openLaunchUrl(launchUrl) {
  if (!launchUrl) return;
  const msg = `Opening launch URL: ${launchUrl}`;
  log(msg);
  console.log(msg);

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

function getAskPassScriptPath() {
   const resourcesPath = app.isPackaged ? process.resourcesPath : path.join(__dirname, 'resources');
   return path.join(resourcesPath, 'askpass.bat');
}

function checkPort(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close();
      resolve(true);
    });
    server.listen(port, '127.0.0.1');
  });
}

async function findAvailablePort(startPort) {
  let port = parseInt(startPort, 10);
  while (!(await checkPort(port))) {
    port++;
    if (port > 65535) port = 10000; // Loop back or fail? Let's generic safeguard.
    if (port === parseInt(startPort, 10)) throw new Error('No available ports managed to be found.');
  }
  return port;
}

async function launchTunnel({ user, host, localPort, remotePort, launchUrl }) {
  const key = `${host}:${localPort}`;

  if (tunnels.has(key)) {
    const msg = `Tunnel to ${key} already exists.`;
    log(msg);
    console.log(msg);
    if (launchUrl) openLaunchUrl(launchUrl);
    return;
  }

  // Find a free port if the requested one is taken (and not by us!)
  let finalPort = parseInt(localPort, 10);
  try {
     finalPort = await findAvailablePort(localPort);
  } catch (err) {
     log(`Error finding port: ${err.message}`);
     dialog.showErrorBox('Port Error', `Could not find an available port starting from ${localPort}`);
     return;
  }

  // If we changed ports, update the launch URL to match
  if (finalPort !== parseInt(localPort, 10)) {
     log(`Port ${localPort} is in use. Switched to ${finalPort}.`);

     if (launchUrl) {
         try {
             const u = new URL(launchUrl);
             if (u.port === localPort.toString()) {
                 u.port = finalPort.toString();
                 launchUrl = u.toString();
                 log(`Updated launch URL to: ${launchUrl}`);
             }
         } catch(e) { /* ignore invalid url */ }
     }
  }

  // Use the NEW port for the key and the SSH command
  const activeKey = `${host}:${finalPort}`;
  // Double check we haven't looped around to an existing tunnel of ours
  if (tunnels.has(activeKey)) {
      const msg = `Tunnel to ${activeKey} already exists (after port resolution).`;
      log(msg);
      if (launchUrl) openLaunchUrl(launchUrl);
      return;
  }

  const sshArgs = ['-v', '-L', `${finalPort}:127.0.0.1:${remotePort}`, `${user}@${host}`];
  const msg = `Opening SSH tunnel: ssh ${sshArgs.join(' ')}`;
  log(msg);
  console.log(msg);

  const env = { ...process.env };
  if (process.platform === 'win32') {
     env.SSH_ASKPASS = getAskPassScriptPath();
     env.SSH_ASKPASS_REQUIRE = 'force';
  }

  const sshProcess = spawn('ssh', sshArgs, {
    windowsHide: true,
    env: env,
    detached: false
  });

  let stderrOutput = '';
  let isConnected = false;

  sshProcess.stdout.on('data', (data) => {
    log(`[SSH stdout] ${data}`);
  });

  sshProcess.stderr.on('data', (data) => {
    const str = data.toString();
    stderrOutput += str;
    log(`[SSH stderr] ${str}`);

    if (!isConnected && (str.includes('Authentication succeeded') || str.includes('Entering interactive session') || str.includes('Local forwarding listening'))) {
        isConnected = true;
        showNotification('Tunnel Connected', `Successfully connected to ${host}`);
    }
  });

  sshProcess.on('close', (code) => {
    log(`SSH process exited with code ${code}`);

    if (tunnels.has(activeKey)) {
        tunnels.delete(activeKey);
        updateTrayMenu();

        if (code !== 0 && code !== null) {
            let errorMessage = `SSH exited with code ${code}`;

            const errors = [];
            if (stderrOutput.includes('invalid format')) {
                errors.push('The SSH key format is invalid. Native SSH requires OpenSSH format keys, but a PuTTY (.ppk) key was likely detected.\nPlease convert your key to OpenSSH format using PuTTYgen.');
            }
            if (stderrOutput.includes('Permission denied')) {
                errors.push('Authentication failed. Please check your SSH keys and permissions.');
            }

            if (errors.length > 0) {
                errorMessage += '\n\n' + errors.join('\n\n');
            }

            dialog.showErrorBox('Tunnel Error', errorMessage);

            if (tunnels.size === 0) {
                app.quit();
            }
        }
    }
  });

  tunnels.set(activeKey, { sshProcess, launchUrl });
  if (launchUrl) openLaunchUrl(launchUrl);
  updateTrayMenu();
}

function handleTunnel(url) {
  log(`Handling URL: ${url}`);
  const tunnelConfig = parseTunnelUrl(url);
  launchTunnel(tunnelConfig);
}

function updateTrayMenu() {
  if (!tray) {
    const iconFile = path.join(process.resourcesPath, 'icon.png');
    tray = new Tray(iconFile);
    tray.setToolTip('CCD Tunnel Helper');
    tray.on('click', () => {
      tray.popUpContextMenu();
    });
  }

  const tunnelEntries = Array.from(tunnels.entries()).map(([key, { sshProcess }]) => {
    return {
      label: `Tunnel: ${key}`,
      submenu: [
        {
          label: 'Disconnect',
          click: () => {
            disconnectTunnel(key);
          },
        }
      ],
    };
  });

  const contextMenu = Menu.buildFromTemplate([
    ...tunnelEntries,
    { type: 'separator' },
    {
      label: 'GitHub',
      click: () => {
        const url = 'https://github.com/ChrisCurdDesign/ccd-tunnel-helper';
        const cmd = process.platform === 'win32'
          ? `start "" "${url}"`
          : process.platform === 'darwin'
          ? `open "${url}"`
          : `xdg-open "${url}"`;
        spawn(cmd, { shell: true, detached: true });
      },
    },
    { type: 'separator' },
    {
      label: 'Exit All Tunnels',
      click: () => {
        for (const key of tunnels.keys()) {
          disconnectTunnel(key);
        }
        app.quit();
      }
    },
  ]);

  tray.setContextMenu(contextMenu);
}

function disconnectTunnel(key) {
  const tunnel = tunnels.get(key);
  if (!tunnel) return;

  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/PID', tunnel.sshProcess.pid, '/F'], { detached: true });
    } else {
      process.kill(tunnel.sshProcess.pid, 'SIGTERM');
    }
    const msg = `Tunnel ${key} disconnected.`;
    log(msg);
    console.log(msg);
    showNotification('Tunnel Disconnected', `Disconnected from ${key}`);
  } catch (err) {
    const msg = `Failed to kill SSH process for ${key}: ${err.message}`;
    log(msg);
    console.error(msg, err);
  }

  tunnels.delete(key);
  updateTrayMenu();

  if (tunnels.size === 0) {
    app.quit();
  }
}

// Ensure single instance
const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine) => {
    log(`Second instance detected with args: ${JSON.stringify(commandLine)}`);
    const url = commandLine.find(arg => arg.startsWith('ccd-tunnel://'));
    if (url) handleTunnel(url);
  });

  app.whenReady().then(() => {
    log('App is ready.');
    if (app.isPackaged && !app.isDefaultProtocolClient('ccd-tunnel')) {
      const exePath = process.execPath;
      app.setAsDefaultProtocolClient('ccd-tunnel', exePath, []);
      log('Set as default protocol client.');
    }

    const args = process.argv.slice(1);
    log(`App started with args: ${JSON.stringify(process.argv)}`);
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
