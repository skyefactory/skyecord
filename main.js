if(require('electron-squirrel-startup')) return;
const { app, BrowserWindow, session, Menu, desktopCapturer, ipcMain } = require('electron/main'); 
const { ConnectionBuilder } = require('electron-cgi'); 
const { updateElectronApp } = require('update-electron-app');
const path = require('path');

updateElectronApp();

let connection;
if (app.isPackaged) {
    const pathToExe = path.join(process.resourcesPath, 'dotnet-build', 'WindowsScreenShareBackend.exe');
    connection = new ConnectionBuilder().connectTo(pathToExe).build();
} else {
    const pathToDll = path.join(__dirname, 'WindowsScreenShareBackend', 'dotnet-build', 'WindowsScreenShareBackend.dll'); 
    connection = new ConnectionBuilder().connectTo('dotnet', pathToDll).build();
}

connection.onDisconnect = () => {
    console.log('Lost connection to the .Net process');
};

connection.send('greet', 'Electron User', (response) => {
    console.log(response); 
});

// IPC communication handlers
ipcMain.handle('get-share-sources', async() => {
    return await desktopCapturer.getSources({
        types: ['window', 'screen'],
        thumbnailSize: { width: 150, height: 150 },
    });
});

let selectedSourceId = null;

ipcMain.on('set-selected-source', (event, id) => {
    selectedSourceId = id;
});

const createWindow = () => {
    const win = new BrowserWindow({
        width: 1280,
        height: 1280,
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            nodeIntegration: false,
            contextIsolation: true
        },
    });

    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
        console.log("Permission requested:", permission);

        const allowedPermissions = [
            'audioCapture', 
            'videoCapture', 
            'display-capture', 
            'media', 
            'clipboard-read', 
            'clipboard-sanitized-write'
        ];
        
        if (allowedPermissions.includes(permission)) {
            return callback(true);
        }
        
        callback(false);
    });

    win.loadFile(
        path.join(__dirname, "client", "index.html")
    );
};

// All initialization happens safely inside whenReady
app.whenReady().then(() => {
    session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
        if(selectedSourceId){
            desktopCapturer.getSources({ types: ['window', 'screen'] }).then(sources => {
                const targetSource = sources.find(source => source.id === selectedSourceId);
                if (!targetSource) {
                    callback({});
                    return;
                }

                callback({
                    video: targetSource,
                    audio: request.audioRequested ? 'loopback' : undefined // Windows system loopback audio
                });
            });
        }
    });

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
