export const isRunningInElectron = !!(window.electronAPI && window.electronAPI.isElectron);
export const sendDebugLogs = true;
export function getStoredValue(key) {
    return localStorage.getItem(key) ?? '';
}

export function setStoredValue(key, value) {
    localStorage.setItem(key, value);
}

export function debugLog(message){
    if(sendDebugLogs){
        console.log(message);
    }
}