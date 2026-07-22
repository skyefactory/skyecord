const {contextBridge, ipcRenderer} = require('electron');

contextBridge.exposeInMainWorld('electronScreenShare',{
    getSources: () => ipcRenderer.invoke('get-share-sources'),
    setTargetSource: (id) => ipcRenderer.send('set-selected-source', id)
});

contextBridge.exposeInMainWorld('electronAPI',{
    isElectron: true,
})