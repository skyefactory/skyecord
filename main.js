if(require('electron-squirrel-startup')) return;

const { app, BrowserWindow, session, Menu } = require('electron/main'); 
const { updateElectronApp } = require('update-electron-app');
const path = require('path');

updateElectronApp();

app.on('web-contents-created', (event, contents) => {
    contents.session.setPermissionRequestHandler(
        (webContents, permission, callback) => {
            console.log("Permission requested:", permission);

            if (permission === 'media') {
                callback(true);
                return;
            }

            callback(false);
        }
    );
});

const createWindow = () => {
    // This will now execute perfectly without throwing an error
    Menu.setApplicationMenu(null); 
    
    const win = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
        }
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