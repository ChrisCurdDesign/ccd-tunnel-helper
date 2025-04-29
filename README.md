# CCD Tunnel Helper

**CCD Tunnel Helper** is a lightweight app that lets you click `ccd-tunnel://` links in your browser to automatically open SSH tunnels in your terminal.

---

## 📦 Installation

| Platform | Instructions |
|:---------|:--------------|
| **Windows** | Download and run `ccd-tunnel-helper-setup.exe` installer. |
| **Mac** | Download `ccd-tunnel-helper.dmg`, open it, and drag `CCD Tunnel Helper` into `Applications`. |
| **Linux** | Download `ccd-tunnel-helper-linux.tar.gz`, extract, and run `install.sh` script. |

The app will automatically register the `ccd-tunnel://` protocol on your system.

---

## 🔗 Usage

Once installed, you can click links like:

```html
<a href="ccd-tunnel://connect?user=ccd_devs&host=123.456.789.123&local_port=2025&remote_port=2025&launch=http%3A%2F%2Flocalhost%3A2025%2Fphpmyadmin%2F">Connect to Dev Server</a>
```

The app will open a terminal and create the requested SSH tunnel automatically.

**Supported URL parameters:**

| Parameter | Description |
|:----------|:------------|
| `user` | SSH username |
| `host` | SSH host IP or DNS name |
| `local_port` | Local port to bind |
| `remote_port` | Remote port to connect |
| `launch` | Optional url to launch after tunnel is established |

Example link:

```html
ccd-tunnel://connect?user=ccd_devs&host=123.456.789.123&local_port=2025&remote_port=2025&launch=http%3A%2F%2Flocalhost%3A2025%2Fphpmyadmin%2F
```

---

## 🧰 Automatic Builds

Releases are automatically built using **GitHub Actions** whenever a new Git tag is pushed.

Workflow builds:
- Windows `.exe` installer
- macOS `.dmg` containing the `.app`
- Linux `.tar.gz` installer package

---

## 💪 Developer Notes

- Built with Node.js.
- Standalone binaries created with [`pkg`](https://github.com/vercel/pkg).
- Windows installer built with NSIS.
- macOS `.app` built manually with `Info.plist` URL scheme handler.
- Linux uses `xdg-mime` to register the protocol handler.

---

## 🔄 Repository Setup

To build manually:

```bash
npm install -g pkg
pkg .
```

To trigger an automatic build and release on GitHub:

```bash
git tag v1.0.0
git push origin v1.0.0
```

---

Made with ❤️ for connecting developers easily!

