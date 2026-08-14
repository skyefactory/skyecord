if(require('electron-squirrel-startup')) return;
const { app, BrowserWindow, session, desktopCapturer, ipcMain } = require('electron/main'); 
const { ConnectionBuilder } = require('electron-cgi'); 
const { updateElectronApp } = require('update-electron-app');
const path = require('path');
const fs = require('fs');

updateElectronApp();

let connection;
const localBackendDir = path.join(__dirname, 'dotnet-build');
const legacyLocalBackendDir = path.join(__dirname, 'WindowsScreenShareBackend', 'dotnet-build');

const getBackendPath = () => {
    if (app.isPackaged) {
        return path.join(process.resourcesPath, 'dotnet-build', 'WindowsScreenShareBackend.exe');
    }

    const preferredPath = path.join(localBackendDir, 'WindowsScreenShareBackend.dll');
    if (fs.existsSync(preferredPath)) {
        return preferredPath;
    }

    return path.join(legacyLocalBackendDir, 'WindowsScreenShareBackend.dll');
};

const startBackendConnection = () => {
    if (connection) {
        return connection;
    }

    const builder = new ConnectionBuilder();

    if (app.isPackaged) {
        builder.connectTo(getBackendPath());
    } else {
        builder.connectTo('dotnet', getBackendPath());
    }

    builder.onExit((code) => {
        console.log(`Connection to ${getBackendPath()} was terminated (code: ${code})`);
    });

    builder.onStderr((data) => {
        console.error(String(data).trimEnd());
    });

    connection = builder.build();

    connection.onDisconnect = () => {
        console.log('Lost connection to the .Net process');
    };

    return connection;
};

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
    startBackendConnection();

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

    if (!app.isPackaged) {
        connection.send('greeting', 'John', (error, theGreeting) => {
            if (error) {
                console.log(error); //serialized exception from the .NET handler
                return;
            }

            console.log(theGreeting); // will print "Hello John!"
        });
    }

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
