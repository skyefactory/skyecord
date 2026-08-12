export const isElectron = window.electronAPI?.isElectron || false;

/*
 * retrieves the value associated with the given key from localStorage.
 *      params:
 *          key - The key whose value is to be retrieved.
 */
export function getStoredValue(key) {
    return localStorage.getItem(key) ?? '';
}

var localVoiceAnimationFrame;
var localIsSpeaking = false;
var localAudioContext = null;
/*
 * sets the value associated with the given key in localStorage.
 *      params:
 *          key - The key whose value is to be set.
 *          value - The value to be set for the given key.
 */
export function setStoredValue(key, value) {
    localStorage.setItem(key, value);
}
const signallingServerUrl = 'wss://signal.skyefactory.com';

/*
 * used to store the state of the local user
 * useful to have this as a class, so it is treated as an object. This removes the read only restriction when this is imported into other modules.
*/
class LocalState {
    constructor(){
        this.localMicrophoneStream = null; // reference to the local microphone stream
        this.localCameraVideoStream = null; // reference to the local camera video stream
        this.localScreenVideoStream = null; // reference to the local screen video stream
        this.localScreenAudioStream = null; // reference to the local screen audio stream

        this.isMuted = false; // are we muted
        this.isDeafened = false // are we deafened
        this.isScreenSharing = false; // are we sharing our screen
        this.isVideo = false; // are we sending video
        this.numPeers = 0; // number of peers in the room
        this.displayName = ''; // display name shown to other users in the room

        this.peerConnections = {}
        this.currentRoomUsers = new Set();
        this.socket = null;
        this.roomId = null;

        this.sessionId = getStoredValue('session_id');
    }
    openSocket(){
        this.socket = new WebSocket(signallingServerUrl);
    }
}

export const localState = new LocalState();

function isAudioOverThreshold(threshold, analyser){
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(dataArray);

    const average = dataArray.reduce((sum, value) => sum + value, 0) / dataArray.length;
    const normalizedValue = average / 255;
    return normalizedValue > threshold;
}

export function isAudioSilent(threshold, analyser, onNoise, onSilence){
    if(isAudioOverThreshold(threshold, analyser)){
        onNoise();
    } else {
        onSilence();
    }
}

export function startVoiceDetectionLocal(stream, onSpeaking, onSilent){
    localAudioContext = new AudioContext();

    const source = localAudioContext.createMediaStreamSource(stream);
    const analyser = localAudioContext.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);

    const check = () => {
        isAudioSilent(0.02, analyser, onSpeaking, onSilent);
        localVoiceAnimationFrame = requestAnimationFrame(check);
    };
    check();
}

export function stopVoiceDetectionLocal(){
    if(localVoiceAnimationFrame){
        cancelAnimationFrame(localVoiceAnimationFrame);
        localVoiceAnimationFrame = null;
    }
    if(localAudioContext){
        localAudioContext.close();
        localAudioContext = null;
    }
}

export function localOnSpeaking(){
    if(localIsSpeaking) return;
    localIsSpeaking = true;
    const localUserListItem = document.getElementById('userlist-' + localState.displayName);
    if(localUserListItem){
        localUserListItem.classList.remove('bg-gray-500');
        localUserListItem.style.backgroundColor = '#22c55e';
    }
}

export function localOnSilent(){
    if(!localIsSpeaking) return;
    const localUserListItem = document.getElementById('userlist-' + localState.displayName);
    if(localUserListItem){
        localUserListItem.classList.add('bg-gray-500');
        localUserListItem.style.backgroundColor = '';
    }
    localIsSpeaking = false;
}


