const { app, Menu, Tray, dialog, Notification, powerMonitor } = require('electron');
const { spawn, exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const net = require('net');
const packageJson = require('./package.json');

let tray = null;
const tunnels = new Map(); // key: `${host}:${localPort}`, value: { sshProcess, launchUrl }
let isSuspending = false;
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

    const user = parsed.searchParams.get('force_user') || null;
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

async function checkAndPromptHost(host) {
  const execAsync = (cmd) => new Promise((resolve, reject) => {
    exec(cmd, (error, stdout, stderr) => {
      // ssh-keygen returns exit code 1 if not found, which is an error in exec
      if (error && error.code !== 1) {
        // Real error (command not found, etc)
        // Check if it's just "host not found" (code 1)
      }
      resolve({ error, stdout, stderr });
    });
  });

  // 1. Check if known
  const { error: findError } = await execAsync(`ssh-keygen -F ${host}`);
  if (!findError) {
    // Found (exit code 0)
    return true;
  }

  // 2. Scan for keys
  const { stdout: scanOutput } = await execAsync(`ssh-keyscan ${host}`);
  if (!scanOutput || !scanOutput.trim()) {
      return true; // Let SSH handle it naturally if scanning fails
  }

  // 3. Get fingerprints
  let fingerprints = '';
  try {
     const child = spawn('ssh-keygen', ['-l', '-f', '-']);
     child.stdin.write(scanOutput);
     child.stdin.end();

     for await (const data of child.stdout) {
         fingerprints += data.toString();
     }
  } catch (err) {
      log(`Fingerprint generation failed: ${err.message}`);
      return true; // Fallback to SSH
  }

  if (!fingerprints) return true;

  // 4. Prompt
  // Clean up fingerprints for display
  const fingerprintMsg = fingerprints.trim();

  // "You probably haven't connected to this host before."
  // "The authenticity of host 'ccd08.ccd.systems (34.89.16.156)' can't be established."
  // "ED25519 key fingerprint is SHA256:..."
  // "Are you sure you want to continue connecting?"

  const message = `You probably haven't connected to this host before.\n\nThe authenticity of host '${host}' can't be established.\n\n${fingerprintMsg}\n\nAre you sure you want to continue connecting?`;

  const { response } = await dialog.showMessageBox({
        type: 'warning',
        buttons: ['Yes', 'No'],
        defaultId: 1,
        cancelId: 1,
        title: 'Security Warning',
        message: 'Unknown Host',
        detail: message,
        noLink: true
  });

  if (response === 0) {
      // User said Yes. Add to known_hosts
      const sshDir = path.join(app.getPath('home'), '.ssh');
      const knownHostsPath = path.join(sshDir, 'known_hosts');

      try {
          if (!fs.existsSync(sshDir)) {
              fs.mkdirSync(sshDir, { recursive: true });
          }
          fs.appendFileSync(knownHostsPath, scanOutput + '\n');
          log(`Added ${host} to known_hosts.`);
          return true;
      } catch (err) {
          log(`Failed to write known_hosts: ${err.message}`);
          dialog.showErrorBox('Error', 'Failed to save host key. Connection may fail.');
          return false;
      }
  } else {
      // User said No
      return false;
  }
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

  // Pre-check host authenticity
  try {
      const allowed = await checkAndPromptHost(host);
      if (!allowed) {
          log(`Connection to ${host} aborted by user (Host verification rejected).`);
          return;
      }
  } catch (err) {
      log(`Host verification check error: ${err.message}`);
      // Proceed blindly? or abort?
      // Proceeding lets standard SSH handling take over
  }

  const sshArgs = ['-v', '-L', `${finalPort}:127.0.0.1:${remotePort}`];
  if (user) {
    sshArgs.push(`${user}@${host}`);
  } else {
    sshArgs.push(host);
  }

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
            if (isSuspending) {
              log(`Suppressing error for ${activeKey} due to system suspension.`);
              if (tunnels.size === 0) {
                app.quit();
              }
              return;
            }

            let errorMessage = `SSH exited with code ${code}`;

            const errors = [];
            if (stderrOutput.includes('Invalid SSH Key Format')) {
                errors.push('The SSH key format is invalid😔\n\nNative SSH requires OpenSSH format keys, but a PuTTY (.ppk) key was likely detected 🤦\n\nThere should be an OpenSSH formatted key in 1Password already, but otherwise please convert your key to OpenSSH format using PuTTYgen 🫡');
            }
            if (stderrOutput.includes('Permission Denied')) {
                errors.push('Authentication failed 😔\n\nHave you set this host up in your SSH config? 🤔\n\nPlease check your SSH keys and permissions 🫡');
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

  const tunnelEntries = Array.from(tunnels.entries()).map(([key, { sshProcess, launchUrl }]) => {
    const submenu = [];
    if (launchUrl) {
      submenu.push({
        label: 'Open',
        click: () => {
          openLaunchUrl(launchUrl);
        },
      });
    }
    submenu.push({
      label: 'Disconnect',
      click: () => {
        disconnectTunnel(key);
      },
    });

    return {
      label: `Tunnel: ${key}`,
      submenu: submenu,
    };
  });

  const contextMenu = Menu.buildFromTemplate([
    ...tunnelEntries,
    { type: 'separator' },
    {
      label: `GitHub - ccd-tunnel-helper v${packageJson.version}`,
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
        showNotification('Tunnels Disconnected', 'All tunnels disconnected, bye!');
        for (const key of tunnels.keys()) {
          disconnectTunnel(key, true);
        }
        app.quit();
      }
    },
  ]);

  tray.setContextMenu(contextMenu);
}

function disconnectTunnel(key, suppressNotification = false) {
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
    if (!suppressNotification) {
      showNotification('Tunnel Disconnected', `Disconnected from ${key}`);
    }
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

    powerMonitor.on('suspend', () => {
      log('System suspending. Suppressing tunnel errors.');
      isSuspending = true;
    });

    powerMonitor.on('resume', () => {
      log('System resuming. Will clear suppression after delay.');
      setTimeout(() => {
        isSuspending = false;
        log('Tunnel error suppression cleared.');
      }, 10000);
    });

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
