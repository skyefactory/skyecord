if(require('electron-squirrel-startup')) return;

const { app, BrowserWindow, session, Menu, desktopCapturer, ipcMain } = require('electron/main'); 
const { updateElectronApp } = require('update-electron-app');
const path = require('path');

updateElectronApp();

ipcMain.handle('get-share-sources', async() =>{
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
        width: 800,
        height: 650,
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            nodeIntegration: false,
            contextIsolation: true
        },
        resizable: false
    });

    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
        console.log("Permission requested:", permission);

        const allowedPermissions = ['audioCapture', 'videoCapture', 'display-capture', 'media', 'clipboard-read', 'clipboard-sanitized-write'];
        
        if (allowedPermissions.includes(permission)) {
            return callback(true);
        }
        
        callback(false);
    });

    win.loadFile(
        path.join(__dirname, "client", "index.html")
    );
};

app.whenReady().then(() => {
    session.defaultSession.setDisplayMediaRequestHandler((request,callback) =>{
        if(selectedSourceId){
            desktopCapturer.getSources({ types: ['window', 'screen'] }).then(sources => {
                const targetSource = sources.find(source => source.id === selectedSourceId);
                if(targetSource){
                    callback({
                        video: targetSource,
                        audio: 'loopback'
                    });
                } else{
                    callback({
                        error: 'No source found with the selected ID'
                    })
                }
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