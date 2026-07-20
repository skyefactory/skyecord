if(require('electron-squirrel-startup')) return;

const { app, BrowserWindow, session, Menu } = require('electron/main'); 
const { updateElectronApp } = require('update-electron-app');
const path = require('path');

updateElectronApp();

// REMOVED: The old app.on('web-contents-created') block has been removed to avoid conflicts.

const createWindow = () => {
    // Note: Creating a BrowserWindow automatically initializes the defaultSession.
    const win = new BrowserWindow({
        width: 800,
        height: 650,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    // Unified Permission Handler
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
        console.log("Permission requested:", permission); // This will log 'audioCapture' for microphones

        const allowedPermissions = ['audioCapture', 'videoCapture', 'display-capture', 'media'];
        
        if (allowedPermissions.includes(permission)) {
            return callback(true); // Automatically grant permission
        }
        
        callback(false); // Reject everything else
    });

    win.loadFile(
        path.join(__dirname, "client", "index.html")
    );
};

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});