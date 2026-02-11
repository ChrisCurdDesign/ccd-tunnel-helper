const { app, Menu, Tray, dialog, Notification, powerMonitor, BrowserWindow, ipcMain, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const { spawn, exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const net = require('net');
const dns = require('dns');
const packageJson = require('./package.json');

autoUpdater.logger = require('electron-log');
autoUpdater.logger.transports.file.level = 'info';
// DISABLE_CODE_SIGNING_CHECK: Required for self-signed or null-signed updates
autoUpdater.skipUpdateExpiredCheck = true;
// autoUpdater.forceDevUpdateConfig = true; // Uncomment if testing dev builds locally

let tray = null;
const tunnels = new Map(); // key: `${host}:${localPort}`, value: { sshProcess, launchUrl }
let isSuspending = false;
const enableLogging = !app.isPackaged || packageJson.enableLogging === true;

function showCustomDialog({ title, message, detail, buttons = ['OK'] }) {
  return new Promise(resolve => {
    const parent = BrowserWindow.getFocusedWindow();
    const width = 600;
    const win = new BrowserWindow({
        width: width,
        height: 100, // Initial small height
        backgroundColor: '#1e1e1e',
        show: false,
        title: title,
        parent: parent,
        modal: !!parent,
        resizable: false,
        minimizable: false,
        maximizable: false,
        frame: true,
        icon: path.join(process.resourcesPath, 'icon.png'),
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    win.setMenu(null);

    const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <style>
            body {
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                background-color: #1e1e1e;
                color: #cccccc;
                margin: 0;
                padding: 24px;
                display: flex;
                flex-direction: column;
                height: auto;
                min-height: fit-content;
                box-sizing: border-box;
                user-select: none;
                font-size: 16px;
            }
            h3 {
                margin-top: 0;
                font-size: 20px;
                font-weight: 600;
                margin-bottom: 8px;
                color: #ffffff;
            }
            .message-header {
                font-size: 16px;
                margin-bottom: 12px;
                color: #e0e0e0;
            }
            .detail {
                flex: 1;
                font-size: 16px;
                line-height: 1.5;
                white-space: pre-wrap;
                overflow-y: auto;
                max-height: 400px;
                padding: 5px;
                margin-bottom: 20px;
                color: #d4d4d4;
            }
            .buttons {
                display: flex;
                justify-content: flex-end;
                gap: 12px;
            }
            button {
                background-color: #3e3e3e;
                color: white;
                border: 1px solid #454545;
                padding: 8px 20px;
                border-radius: 4px;
                cursor: pointer;
                font-size: 16px;
                min-width: 80px;
                transition: background-color 0.1s;
            }
            button:hover {
                background-color: #4e4e4e;
            }
            button:focus {
                outline: 1px solid #0078d4;
                border-color: #0078d4;
            }
            button.primary {
                background-color: #0078d4;
                border-color: #0078d4;
            }
            button.primary:hover {
                background-color: #106ebe;
                border-color: #106ebe;
            }
            /* Scrollbar styling */
            ::-webkit-scrollbar { width: 10px; }
            ::-webkit-scrollbar-track { background: #1e1e1e; }
            ::-webkit-scrollbar-thumb { background: #424242; border-radius: 5px; border: 2px solid #1e1e1e; }
            ::-webkit-scrollbar-thumb:hover { background: #4f4f4f; }
        </style>
    </head>
    <body onkeydown="handleKey(event)">
        <h3>${title}</h3>
        ${message ? `<div class="message-header">${message}</div>` : ''}
        <div class="detail">${detail ? detail : ''}</div>
        <div class="buttons">
            ${buttons.map((btn, i) => `<button id="btn-${i}" class="${i === 0 ? 'primary' : ''}" onclick="reply(${i})">${btn}</button>`).join('')}
        </div>
        <script>
            const { ipcRenderer } = require('electron');

            function reply(i) {
                // Disable buttons to prevent double click
                const btns = document.querySelectorAll('button');
                btns.forEach(b => b.disabled = true);
                ipcRenderer.send('dialog-reply-${win.id}', i);
            }

            function handleKey(e) {
                if (e.key === 'Escape') {
                    reply(${buttons.length - 1});
                }
            }

            window.onload = () => {
                const primary = document.querySelector('.primary') || document.querySelector('button');
                if (primary) primary.focus();

                // Send content height
                const height = document.body.scrollHeight;
                ipcRenderer.send('dialog-resize-${win.id}', height);
            };
        </script>
    </body>
    </html>
    `;

    const dataUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
    win.loadURL(dataUrl);

    // Initial show replaced by resize event
    ipcMain.once(`dialog-resize-${win.id}`, (event, height) => {
        // Adjust height for window frame (approx 30-40px depending on OS, but setContentSize sets client area usually)
        // Electron setContentSize sets the client area size (inside the window frame).
        // Since document.body.scrollHeight is the content height, this should work.
        win.setContentSize(width, Math.ceil(height));
        win.center();
        win.show();
        shell.beep();
    });

    // Cleanup helper
    let resolved = false;
    const cleanup = () => {
        if (resolved) return;
        resolved = true;
        // if window is still exists ??
    };

    ipcMain.once(`dialog-reply-${win.id}`, (event, index) => {
        if (resolved) return;
        resolved = true;
        resolve({ response: index });
        // Small timeout to allow button animation or similar? No, just close.
        win.close();
    });

    win.on('closed', () => {
       if (!resolved) {
           resolved = true;
           resolve({ response: buttons.length - 1 });
       }
    });
  });
}

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

  const checkKeyExists = async (h) => {
      try {
          const { error } = await execAsync(`ssh-keygen -F ${h}`);
          return !error;
      } catch (e) { return false; }
  };

  // Resolve IP to check both
  let ip = null;
  try {
      const lookup = require('util').promisify(dns.lookup);
      const { address } = await lookup(host);
      if (address !== host) ip = address;
  } catch (e) { /* ignore */ }

  // 1. Check if known
  const hostKnown = await checkKeyExists(host);
  const ipKnown = ip ? await checkKeyExists(ip) : true;

  if (hostKnown && ipKnown) {
      return true;
  }

  // 2. Scan for keys (scan both host and IP to be sure)
  showNotification('Verify Host', 'Checking host authenticity...');

  const scanTarget = ip ? `${host} ${ip}` : host;
  // Note: if scanning multiple args, ssh-keyscan outputs entries for each.

  const { stdout: scanOutput, stderr: scanError } = await execAsync(`ssh-keyscan ${scanTarget}`);
  if (!scanOutput || !scanOutput.trim()) {
      log(`ssh-keyscan returned empty output. Error: ${scanError}`);
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
  // "The authenticity of host '<hostname> (<ip address>)' can't be established."
  // "ED25519 key fingerprint is SHA256:..."
  // "Are you sure you want to continue connecting?"

  const message = `You probably haven't tunnelled to this host before.\n\nThe authenticity of host '${host}' can't be established.\n\n${fingerprintMsg}\n\nAre you sure you want to continue connecting?`;

  const { response } = await showCustomDialog({
        title: 'Security Warning',
        message: 'Unknown Host',
        detail: message,
        buttons: ['Yes', 'No']
  });

  if (response === 0) {
      // User said Yes. Add to known_hosts
      const sshDir = path.join(app.getPath('home'), '.ssh');
      const knownHostsPath = path.join(sshDir, 'known_hosts');

      try {
          if (!fs.existsSync(sshDir)) {
              fs.mkdirSync(sshDir, { recursive: true });
          }

          // Filter out comments and empty lines
          const validLines = scanOutput.split('\n')
              .map(line => line.trim())
              .filter(line => line.length > 0 && !line.startsWith('#'));

          if (validLines.length === 0) {
              log('No valid keys found in ssh-keyscan output.');
              return true; // Let SSH try on its own
          }

          let content = validLines.join('\n') + '\n';

          if (fs.existsSync(knownHostsPath)) {
              const currentContent = fs.readFileSync(knownHostsPath, 'utf8');
              if (currentContent.length > 0 && !currentContent.endsWith('\n')) {
                  content = '\n' + content;
              }
          }

          fs.appendFileSync(knownHostsPath, content);
          log(`Added ${host} to known_hosts.`);

          await new Promise(r => setTimeout(r, 200));
          return true;
      } catch (err) {
          log(`Failed to write known_hosts: ${err.message}`);
          showCustomDialog({
            title: 'Error',
            message: 'Save Failed',
            detail: 'Failed to save host key. Connection may fail.',
            buttons: ['OK']
          });
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
     showCustomDialog({
        title: 'Port Error',
        message: 'Port Allocation Failed',
        detail: `Could not find an available port starting from ${localPort}`,
        buttons: ['OK']
     });
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
      log(`Host verifiction passed for ${host}.`);
  } catch (err) {
      log(`Host verification check error: ${err.message}`);
      // Proceed blindly? or abort?
      // Proceeding lets standard SSH handling take over
  }

  log('Preparing to spawn SSH process...');

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

  sshProcess.on('close', async (code) => {
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
            const outputLower = stderrOutput.toLowerCase();

            const errors = [];
            if (outputLower.includes('invalid format') || outputLower.includes('invalid ssh key format')) {
                errors.push('The SSH key format is invalid😔\n\nNative SSH requires OpenSSH format keys, but a PuTTY (.ppk) key was likely detected 🤦\n\nThere should be an OpenSSH formatted key in 1Password already, but otherwise please convert your key to OpenSSH format using PuTTYgen 🫡');
            }
            if (outputLower.includes('permission denied')) {
                errors.push('Authentication failed 😔\n\nHave you set this host up in your SSH config? 🤔\n\nPlease check your SSH keys and permissions 🫡');
            }
            if (outputLower.includes('could not resolve hostname')) {
                errors.push(`Could not find host '${host}' 😔\n\nHave you added this host to your SSH config yet? 🤔\n\nPlease check your ~/.ssh/config file 🫡`);
            }
            if (outputLower.includes('host key verification failed') || outputLower.includes('server rejected our key')) {
                errors.push(`Host key verification failed 😔\n\nIt seems the server's identity has changed, or we failed to save the key correctly.\n\nYou may need to remove the old key from your known_hosts file manually.`);
            }

            if (errors.length > 0) {
                errorMessage += '\n\n' + errors.join('\n\n');
            }

            await showCustomDialog({
                title: 'Tunnel Error',
                message: 'Connection Failed',
                detail: errorMessage,
                buttons: ['OK']
            });

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
    {
      label: 'Check for Updates',
      click: () => {
        log('Manual check for updates triggered.');
        autoUpdater.checkForUpdatesAndNotify();
      }
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
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.ccd.tunnelhelper');
  }

  app.on('second-instance', (event, commandLine) => {
    log(`Second instance detected with args: ${JSON.stringify(commandLine)}`);
    const url = commandLine.find(arg => arg.startsWith('ccd-tunnel://'));
    if (url) handleTunnel(url);
  });

  // Prevent app from quitting when all windows (dialogs) are closed
  app.on('window-all-closed', () => {
    // Do nothing, keep running in tray
  });

  app.whenReady().then(() => {
    log('App is ready.');

    autoUpdater.checkForUpdatesAndNotify();

    autoUpdater.on('checking-for-update', () => {
      log('Checking for update...');
    });
    autoUpdater.on('update-available', (info) => {
      log('Update available: ' + info.version);
    });
    autoUpdater.on('update-not-available', (info) => {
      log('Update not available.');
    });
    autoUpdater.on('error', (err) => {
      log('Error in auto-updater: ' + err);
    });
    autoUpdater.on('download-progress', (progressObj) => {
      let log_message = "Download speed: " + progressObj.bytesPerSecond;
      log_message = log_message + ' - Downloaded ' + progressObj.percent + '%';
      log_message = log_message + ' (' + progressObj.transferred + "/" + progressObj.total + ')';
      log(log_message);
    });
    autoUpdater.on('update-downloaded', (info) => {
      log('Update downloaded: ' + info.version);
    });

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
      showCustomDialog({
        title: 'CCD Tunnel Helper',
        message: 'Ready',
        detail: 'CCD Tunnel Helper was successfully installed and is now ready to handle ccd-tunnel:// links.',
        buttons: ['OK']
      }).then(() => {
        app.quit();
      });
    }
  });
}
