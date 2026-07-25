import {isRunningInElectron, getStoredValue, setStoredValue,debugLog, sendDebugLogs} from './common.js';
console.log('isRunningInElectron:', isRunningInElectron);
console.log('sendDebugLogs:', sendDebugLogs);
/******************************************************** 
 * Constants
********************************************************/
//Url parameters

var displayName = new URLSearchParams(window.location.search).get('name');
const roomId = new URLSearchParams(window.location.search).get('roomId');

//Audio
const joinedAudio = './audio/joined.wav';
const leftAudio = './audio/left.wav';
const startedVideoAudio = './audio/started-video.wav';
const goodByeAudio = './audio/goodbye.wav';
const mutedAudio = './audio/muted.wav';
const deafenedAudio = './audio/deafened.wav';
const unmutedAudio = './audio/unmuted.wav';
const undeafenedAudio = './audio/undeafened.wav';

//Ui elements
const muteMicButton = document.getElementById('mute-mic');
const deafenSelfButton = document.getElementById('deafen-self');
const leaveRoomButton = document.getElementById('leave-room');
const screenShareButton = document.getElementById('screen-share');
const videoButton = document.getElementById('video');
const textChatInput = document.getElementById('text-chat-input');
const textChatSendButton = document.getElementById('text-chat-send');
const textChatMessagesList = document.getElementById('text-chat-messages');
const textChatContainer = document.getElementById('text-chat-container');


//Auth
const sessionId = getStoredValue('session_id');
var saltBytes;
var secretString;
var showedNoKeyError = false;

const urlParams = new URLSearchParams(window.location.search);
if (urlParams.has('secret')) {
    secretString = urlParams.get('secret');
}

var secretBytes;
if(secretString){
    secretString = secretString
        .replace(/-/g, "+")
        .replace(/_/g, "/");

    while (secretString.length % 4)
        secretString += "=";

    secretBytes = Uint8Array.from(
        atob(secretString),
        c => c.charCodeAt(0)
    );
}


var ROOM_KEY = null;

async function getRoomKey(secretBytes, saltBytes){
    saltBytes = Uint8Array.from(Object.values(saltBytes));
    const key = await crypto.subtle.importKey(
        "raw",
        secretBytes,
        "HKDF",
        false,
        ["deriveKey"]);

    return await crypto.subtle.deriveKey(
        {
            name: "HKDF",
            hash: "SHA-256",
            salt: saltBytes,
            info: new TextEncoder().encode(
                "skyecord-room-key"
            )
        },
        key,
        {
            name: "AES-GCM",
            length: 256
        },
        false,
        ["encrypt", "decrypt"]
    );
}


//WEBRTC

const signallingServerURL = 'wss://signal.skyefactory.com';
const socket = new WebSocket(signallingServerURL);
const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' }
    ]
};
const constraints = {
    audio: true,
    video: false
};

//State

let localMicrophoneStream = null;
let isMuted = false;
let isDeafened = false;
let isScreenSharing = false;
let numPeers = 0;
const peerConnections = {};

/******************************************************** 
 * Functions
********************************************************/

// UI Functions

function bindDialogControls(root, openSelector, dialogSelector, closeSelector) {
    if (!root) {
        return;
    }

    const openButton = root.querySelector(openSelector);
    const dialog = root.querySelector(dialogSelector);
    const closeButton = root.querySelector(closeSelector);

    if (!openButton || !dialog || !closeButton) {
        return;
    }

    openButton.addEventListener('click', () => {
        dialog.showModal();
    });

    closeButton.addEventListener('click', () => {
        dialog.close();
    });
}

async function playSystemSound(soundPath) {
    const audioElement = document.getElementById('application');
    if (!audioElement || !soundPath) {
        return;
    }

    try {
        audioElement.pause();
        if (audioElement.src !== soundPath) {
            audioElement.src = soundPath;
        }
        audioElement.currentTime = 0;
        await audioElement.play();
    } catch (err) {
        console.warn('System sound playback failed for', soundPath, err);
    }
}

function updateControlAvailability() {
    screenShareButton.disabled = numPeers === 0;
    videoButton.disabled = numPeers === 0;
    screenShareButton.style.opacity = numPeers === 0 ? 0.5 : 1;
    videoButton.style.opacity = numPeers === 0 ? 0.5 : 1;
}

function updateUserCountandList(users, numusers) {
    if (numusers > numPeers + 1) {
        playSystemSound(joinedAudio);
    } else if (numusers < numPeers + 1) {
        playSystemSound(leftAudio);
    }

    numPeers = numusers - 1;
    updateControlAvailability();
    document.getElementById('room-status').style.display = 'block';
    document.getElementById('user-count').textContent = numusers + (numusers === 1 ? ' user' : ' users');

    const userList = document.getElementById('user-list');
    userList.innerHTML = '';

    users.forEach(user => {
        const listItem = document.createElement('li');
        listItem.id = 'userlist-' + user;
        if (user === displayName) {
            listItem.textContent = user + ' (You)';
            listItem.className = 'p-1 bg-gray-500 text-white font-bold ';

            const selfControls = document.getElementById('self-controls');
            const controlsInstance = selfControls.cloneNode(true);
            if (controlsInstance) {
                controlsInstance.style.display = 'inline';
                bindDialogControls(controlsInstance, '.self-controls-open', 'dialog', '.self-controls-close');
                listItem.appendChild(controlsInstance);
                const saveButton = controlsInstance.querySelector('.save-button-self-controls');
                if (saveButton) {
                    saveButton.addEventListener('click', () => {
                        const nicknameInput = controlsInstance.querySelector('.nickname-input');
                        if (nicknameInput) {
                            const newNickname = nicknameInput.value.trim();
                            setStoredValue('nickname', newNickname);
                            if(newNickname && newNickname !== displayName  && newNickname !== '') {
                                socket.send(JSON.stringify({ type: 'update-displayname', oldName: displayName, newName: newNickname, roomId: roomId, sessionId: sessionId }));
                            }
                        }
                        const dialog = controlsInstance.querySelector('dialog');
                        if (dialog) {
                            dialog.close();
                        }
                    });
                } 
            }
        } else {
            listItem.className = 'p-1 bg-skye-gray-input text-white w-[75%]';
            listItem.textContent = user;
        }
        const mutedIndicator = document.createElement('img');
        mutedIndicator.id = 'muted-indicator-' + user;
        mutedIndicator.src = './svgicons/mic_off.svg';
        mutedIndicator.alt = 'Muted';
        mutedIndicator.className = 'w-6 h-6 ml-2 hidden';

        const deafenedIndicator = document.createElement('img');
        deafenedIndicator.id = 'deafened-indicator-' + user;
        deafenedIndicator.src = './svgicons/media_output_off.svg';
        deafenedIndicator.alt = 'Deafened';
        deafenedIndicator.className = 'w-6 h-6 ml-2 hidden';
        

        listItem.appendChild(mutedIndicator);
        listItem.appendChild(deafenedIndicator);
        userList.appendChild(listItem);
    });
}

function updatePeerStatus(peerName, status) {
    const mutedIndicator = document.getElementById('muted-indicator-' + peerName);
    const deafenedIndicator = document.getElementById('deafened-indicator-' + peerName);
    if (mutedIndicator) {
        mutedIndicator.classList.add(status.muted ? 'inline-block' : 'hidden');
        mutedIndicator.classList.remove(status.muted ? 'hidden' : 'inline-block');
    }

    if (deafenedIndicator) {
        deafenedIndicator.classList.add(status.deafened ? 'inline-block' : 'hidden');
        deafenedIndicator.classList.remove(status.deafened ? 'hidden' : 'inline-block');
    }
}


// Peer management Functions

async function updatePeers(users) {
    for (const user of users) {
        if (user !== displayName && !peerConnections[user]) {
            const peer = new Peer(user);
            peerConnections[user] = peer;
            await peer.start();
        }
    }
}

// Utility Functions


async function encryptMessage(message, key) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
        {
            name: "AES-GCM",
            iv: iv
        },
        key,
        new TextEncoder().encode(message)
    );
    return {encrypted: new Uint8Array(encrypted), iv: iv};
}

async function decryptMessage(encrypted, iv, key) {
    const decrypted = await crypto.subtle.decrypt(
        {
            name: "AES-GCM",
            iv: iv
        },
        key,
        encrypted
    );
    return new TextDecoder().decode(decrypted);
}


function isAudioOverThreshold(threshold, analyser){
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(dataArray);

    const average = dataArray.reduce((sum, value) => sum + value, 0) / dataArray.length;
    const normalizedValue = average / 255;
    return normalizedValue > threshold;
}

function isAudioSilent(threshold, analyser, onNoise, onSilence){
    if(isAudioOverThreshold(threshold, analyser)){
        onNoise();
    } else {
        onSilence();
    }
}


bindDialogControls(document.getElementById('self-controls'), '.self-controls-open', 'dialog', '.self-controls-close');
bindDialogControls(document.getElementById('other-controls'), '.other-controls-open', 'dialog', '.other-controls-close');

/******************************************************** 
 * Peer Class
********************************************************/
class PeerStreams{
    constructor() {
        this.microphoneAudio = null; // This is the remote microphone audio stream from the peer
        this.camVideo = null; // This is the remote camera video stream from the peer
        this.screenAudio = null; // This is the remote screen share audio stream from the peer
        this.screenVideo = null; // This is the remote screen share video stream from the peer
    }
}


class Peer {
    // Constructor
    constructor(peerName) {
        this.peerName = peerName;
        this.iceCandidateQueue = [];
        this.pc = new RTCPeerConnection(configuration);
        this.polite = displayName < peerName;
        this.makingOffer = false;
        this.ignoreOffer = false;
        this.isSettingRemoteAnswerPending = false;
        this.otherVolume = 1.0;
        this.remoteStatus = { muted: false, deafened: false };
        this.remoteStreams = new PeerStreams();
        
        this.chatChannel = null;
        this.statusChannel = null;

        this.setupPeerConnectionEvents();
        this.setupDataChannels();
    }

    setupDataChannels() {
        if (!this.polite) {
            this.chatChannel = this.pc.createDataChannel('chat-channel', { negotiated: false });
            this.statusChannel = this.pc.createDataChannel('status-channel', { negotiated: false });
            
            this.bindChannelEvents(this.chatChannel, 'chat');
            this.bindChannelEvents(this.statusChannel, 'status');
        } else {
            this.pc.ondatachannel = (event) => {
                const channel = event.channel;
                if (channel.label === 'chat-channel') {
                    this.chatChannel = channel;
                    this.bindChannelEvents(this.chatChannel, 'chat');
                } else if (channel.label === 'status-channel') {
                    this.statusChannel = channel;
                    this.bindChannelEvents(this.statusChannel, 'status');
                }
            };
        }
    }

    bindChannelEvents(channel, type) {
        channel.onopen = () => {
            debugLog(` channel [${type}] with ${this.peerName} is OPEN`);
            // Example: Send initial local status once channel opens
            if (type === 'status') {
                this.sendStatusUpdate({ muted: isMuted, deafened: isDeafened });
            }
        };

        channel.onclose = () => {
            debugLog(` channel [${type}] with ${this.peerName} is CLOSED`);
        };

        channel.onerror = (error) => {
            console.error(` channel [${type}] error with ${this.peerName}:`, error);
        };

        channel.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (type === 'chat') {
                    this.handleIncomingChat(data);
                } else if (type === 'status') {
                    this.handleIncomingStatus(data);
                }
            } catch (err) {
                console.error(`Failed parsing message on channel [${type}]:`, err);
            }
        };
    }

    sendChatMessage(text) {
        if (this.chatChannel && this.chatChannel.readyState === 'open') {
            this.chatChannel.send(JSON.stringify({ sender: displayName, text: text, timestamp: Date.now() }));
        }
    }

    sendStatusUpdate(statusObj) {
        if (this.statusChannel && this.statusChannel.readyState === 'open') {
            this.statusChannel.send(JSON.stringify(statusObj));
        }
    }

    handleIncomingChat(data) {
        const message = data.text.trim();
        const timestamp = new Date(data.timestamp).toLocaleTimeString();
        if (message && message.length > 0) {
            const messageItem = document.createElement('li');
            messageItem.className = 'p-1 bg-skye-gray-input text-white text-[12px]';
            messageItem.innerHTML = `<b>${this.peerName}:</b> ${message} <span class="text-[10px] text-gray-400">(${timestamp})</span>`;
            textChatMessagesList.appendChild(messageItem);
            textChatContainer.scrollTop = textChatContainer.scrollHeight;
        }
    }

    handleIncomingStatus(data) {
        this.remoteStatus.muted = data.muted;
        this.remoteStatus.deafened = data.deafened;
        updatePeerStatus(this.peerName, this.remoteStatus);              
    }
    //Initialization
    async start() {
        try {
            //Local Microphone Stream is OUR microphone. This is what we send to the peer. This is shared across all peers.
            //Each peer will have a corresponding 'Remote Stream' which is their own microphone audio they send to us.

            if (localMicrophoneStream === null) {
                localMicrophoneStream = await navigator.mediaDevices.getUserMedia(constraints);
            }

            for (const track of localMicrophoneStream.getTracks()) {
                this.pc.addTrack(track, localMicrophoneStream);
            }

        } catch (err) {
            alert('skyecord was unable to access your microphone. Check if your browser is requesting permissions or if you have it blocked.')
            console.error('Error accessing media devices.', err);
        }
    }

    //Peer Connections

    setupPeerConnectionEvents(){
        this.pc.ontrack  = (e) => this.onTrack(e);
        this.pc.onicecandidate = (e) => this.onIceCandidate(e);
        this.pc.onconnectionstatechange = () => this.onConnectionStateChange();
        this.pc.onnegotiationneeded = () => this.onNegotiationNeeded();
    }
    onTrack(event) {
        const { track, streams } = event;

        let stream = (streams && streams.length) ? streams[0] : null;
        if (!stream) {
            stream = new MediaStream();
            stream.addTrack(track);
        }

        const trackType = track.kind;

        if (trackType === 'audio') {
            this.remoteStreams.microphoneAudio = stream;
            const audioId = `audio-${this.peerName}`;
            let audioElement = document.getElementById(audioId);
            if (!audioElement) {
                audioElement = document.createElement('audio');
                audioElement.id = audioId;
                audioElement.controls = false;
                audioElement.hidden = false;
                audioElement.style.display = 'none';
                audioElement.autoplay = true;
                audioElement.playsInline = true;
                document.body.appendChild(audioElement);
            }

            if (audioElement.srcObject !== stream) {
                audioElement.srcObject = stream;
            }

            const tryPlay = async () => {
                try {
                    await audioElement.play();
                } catch (err) {
                    console.warn('Autoplay prevented for', audioId, err);
                }
            };

            if (track.readyState === 'live' && !track.muted) {
                tryPlay();
            } else {
                track.onunmute = tryPlay;
            }

            this.startVoiceDetection(stream);
        }

        if (trackType === 'video') {
            playSystemSound(startedVideoAudio);
        }
    }
    onIceCandidate(event) {
        const candidate = event.candidate;
        if (candidate) {
            socket.send(JSON.stringify({ type: 'ice-candidate', candidate: candidate, target: this.peerName, roomId: roomId, sessionId: sessionId }));
        }
    }
    onConnectionStateChange(){
        if (this.pc.connectionState === 'disconnected' || this.pc.connectionState === 'failed' || this.pc.connectionState === 'closed') {
            const audioElement = document.getElementById(`audio-${this.peerName}`);
            if (audioElement) {
                audioElement.srcObject = null;
                audioElement.remove();
            }
            this.stopVoiceDetection();
            this.pc.close();
            delete peerConnections[this.peerName];
        }
    }
    async onNegotiationNeeded(){
        try {
            this.makingOffer = true;
            await this.pc.setLocalDescription();
            socket.send(JSON.stringify({ type: 'offer', description: this.pc.localDescription, target: this.peerName, roomId: roomId, sessionId: sessionId }));
        } catch (err) {
            console.error('Error during negotiation.', err);
        } finally {
            this.makingOffer = false;
        }
    }

    //Helpers
    queueIceCandidate(candidate) {}
    flushIceCandidateQueue(){}

    stopVoiceDetection(){
        if (this.voiceAnimationFrame) {
            cancelAnimationFrame(this.voiceAnimationFrame);
            this.voiceAnimationFrame = null;
        }
        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }
    }

    startVoiceDetection(stream){
        this.audioContext = new AudioContext();

        const source = this.audioContext.createMediaStreamSource(stream);
        this.analyser = this.audioContext.createAnalyser();
        this.analyser.fftSize = 512;
        source.connect(this.analyser);

        const check = () =>{
            isAudioSilent(0.02, this.analyser, ()=> this.onSpeaking(), ()=> this.onSilent());
            this.voiceAnimationFrame = requestAnimationFrame(check);
        };

        check();
    }

    onSpeaking(){
        if(this.isSpeaking) return;
        this.isSpeaking = true;
        // find the user in the user list and change color
        const userListItem = document.getElementById('userlist-' + this.peerName);
        if (userListItem) {
            userListItem.classList.remove('bg-skye-gray-input');
            userListItem.style.backgroundColor = '#22c55e';
        }
    }

    onSilent(){
        if(!this.isSpeaking) return;
        const userListItem = document.getElementById('userlist-' + this.peerName);
        if (userListItem) {
            userListItem.classList.add('bg-skye-gray-input');
            userListItem.style.backgroundColor = '';
        }
        this.isSpeaking = false;
    }

    //Socket calls
    async receiveDescription(description, from){
    if (description) {
            const readyForOffer = !this.makingOffer && (this.pc.signalingState === 'stable' || this.isSettingRemoteAnswerPending);
            const offerCollision = description.type === 'offer' && !readyForOffer;
            this.ignoreOffer = !this.polite && offerCollision;
            if (this.ignoreOffer) {
                return;
            }
            this.isSettingRemoteAnswerPending = description.type === 'answer';
            await this.pc.setRemoteDescription(description);
            this.isSettingRemoteAnswerPending = false;
            for (const candidate of this.iceCandidateQueue) {
                try {
                    await this.pc.addIceCandidate(candidate);
                } catch(err) {
                    if(!this.ignoreOffer) {
                        console.error(err);
                    }
                }
            }
            this.iceCandidateQueue = [];
            if (description.type === 'offer') {
                try {
                    await this.pc.setLocalDescription();
                } catch (err) {
                    console.error('Error setting local description for answer', err);
                }
                socket.send(JSON.stringify({ type: 'offer', description: this.pc.localDescription, target: from, roomId: roomId, sessionId: sessionId }));
            }
            return;
        }
    }
    async receiveIceCandidate(candidate, from){
        if (candidate) {
            if (this.pc.remoteDescription) {
                try {
                    await this.pc.addIceCandidate(candidate);
                } catch (err) {
                    console.error('Error adding remote ICE candidate', err);
                }
            } else {
                this.iceCandidateQueue.push(candidate);
            } 
        }
    }
}


/******************************************************** 
 * UI event listeners
********************************************************/

leaveRoomButton.addEventListener('click', () => {
    playSystemSound(goodByeAudio);
    for (const peerName in peerConnections) {
        peerConnections[peerName].stopVoiceDetection();
        peerConnections[peerName].chatChannel?.close();
        peerConnections[peerName].statusChannel?.close();
        peerConnections[peerName].pc.ontrack = null;
        peerConnections[peerName].pc.onicecandidate = null;
        peerConnections[peerName].pc.onconnectionstatechange = null;
        peerConnections[peerName].pc.onnegotiationneeded = null;
        peerConnections[peerName].pc.ondatachannel = null;
        const audioElement = document.getElementById(`audio-${peerName}`);
        if (audioElement) {
            audioElement.srcObject = null;
            audioElement.remove();
        }
        peerConnections[peerName].pc.close();
    }
    socket.close(1000, 'User left the room');
});

muteMicButton.addEventListener('click', () => {
    if (localMicrophoneStream) {
        isMuted = !isMuted;
        localMicrophoneStream.getAudioTracks().forEach(track => {
            track.enabled = !isMuted;
        });
        muteMicButton.innerHTML = isMuted
            ? '<img src="./svgicons/mic_off.svg" alt="Unmute Microphone">'
            : '<img src="./svgicons/mic.svg" alt="Mute Microphone">';
        playSystemSound(isMuted ? mutedAudio : unmutedAudio);
        for (const peerName in peerConnections) {
            peerConnections[peerName].sendStatusUpdate({ muted: isMuted, deafened: isDeafened });
        }
    }
});

deafenSelfButton.addEventListener('click', () => {
    isDeafened = !isDeafened;
    const audioElements = document.querySelectorAll('audio');
    audioElements.forEach(audio => {
        if (audio.id !== 'application') {
            audio.muted = isDeafened;
        }
    });
    deafenSelfButton.innerHTML = isDeafened
        ? '<img src="./svgicons/media_output_off.svg" alt="Un-deafen Self">'
        : '<img src="./svgicons/media_output.svg" alt="Deafen Self">';
    playSystemSound(isDeafened ? deafenedAudio : undeafenedAudio);
    for (const peerName in peerConnections) {
        peerConnections[peerName].sendStatusUpdate({ muted: isMuted, deafened: isDeafened });
    }
});

textChatInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
        event.preventDefault(); // Prevent default behavior if inside a form
        textChatSendButton.click();   // Reuse your existing send button logic
    }
});


screenShareButton.addEventListener('click', async () => {
    try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
            alert('Screen sharing is not supported in this browser.');
            return;
        }

        isScreenSharing = !isScreenSharing;
        if (!isScreenSharing) {
            for (const peerName in peerConnections) {
                const sender = peerConnections[peerName].pc.getSenders().find(s => s.track && s.track.kind === 'video');
                if (sender) {
                    sender.replaceTrack(null);
                }
            }
            screenShareButton.innerHTML = '<img src="./svgicons/screen_share.svg" alt="Start Screen Share">';
            return;
        }

        screenShareButton.innerHTML = '<img src="./svgicons/stop_screen_share.svg" alt="Stop Screen Share">';
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        const screenTrack = screenStream.getVideoTracks()[0];

        for (const peerName in peerConnections) {
            const sender = peerConnections[peerName].pc.getSenders().find(s => s.track && s.track.kind === 'video');
            if (sender) {
                sender.replaceTrack(screenTrack);
            } else {
                peerConnections[peerName].pc.addTrack(screenTrack, screenStream);
            }
        }
    } catch (err) {
        alert('skyecord was unable to access your display for screen sharing. Check if your browser is requesting permissions or if you have it blocked.')
        console.error('Error accessing display media.', err);
    }
});

textChatSendButton.addEventListener('click', async () => {
    const message = textChatInput.value.trim();
    const timestamp = new Date().toLocaleTimeString();
    if (message && message.length > 0) {
        if (message.length > 500) {
            alert('Message is too long. Please limit to 500 characters.');
            return;
        }
        for (const peerName in peerConnections) {
            peerConnections[peerName].sendChatMessage(message);
        }
        const messageItem = document.createElement('li');
        messageItem.className = 'p-1 bg-skye-gray-input text-white text-[12px]';
        messageItem.innerHTML = `<b>You:</b> ${message} <span class="text-[10px] text-gray-400">(${timestamp})</span>`;
        textChatMessagesList.appendChild(messageItem);
        textChatInput.value = '';
        textChatContainer.scrollTop = textChatContainer.scrollHeight;

        // Encrypt message and then send it to the server for logging
        if (ROOM_KEY) {
            await encryptMessage(message, ROOM_KEY).then(encryptedMessage => {
                const logMessage = JSON.stringify({ type: 'log', message: encryptedMessage.encrypted, iv: encryptedMessage.iv, timestamp: Date.now(), roomId: roomId, sessionId: sessionId });
                socket.send(logMessage);
            }).catch(err => {
                console.error('Error encrypting message for logging:', err);
            });
        } else {
            console.warn('Room key is not available. Message will not be logged.');
            if(!showedNoKeyError) {
                alert('Room key is not available. Messages history is unavailable and your messages will not be logged. Please ensure you entered the correct secret key');
                showedNoKeyError = true;
            }
            
        }
    }
});

/******************************************************** 
 * Websocket events
********************************************************/

socket.addEventListener('open', () => {
    const nameRoomMessage = JSON.stringify({ type: 'join', name: displayName, roomId: roomId, sessionId: sessionId });
    socket.send(nameRoomMessage);
});

socket.addEventListener('close', (event) => {
    if (event.reason === 'Invalid room ID') {
        window.location.href = 'index.html?error=0';
    } else if (event.reason === 'Username already taken') {
        window.location.href = 'index.html?error=1';
    } else if (event.reason === 'Invalid JSON message') {
        window.location.href = 'index.html?error=2';
    } else if (event.reason === 'Unknown message type') {
        window.location.href = 'index.html?error=3';
    } else {
        window.location.href = 'index.html';
    }
});

socket.addEventListener('message', async (event) => {
    let data;
    try {
        data = JSON.parse(event.data);
    } catch (err) {
        console.error('Error parsing message from server', err);
        return;
    }

    switch (data.type) {
        case 'joined':
        
            document.getElementById('room-name').textContent = data.roomName;
            document.getElementById('room-id').textContent = roomId;
            saltBytes = data.saltBytes;
            if(secretBytes && saltBytes) {
                ROOM_KEY = await getRoomKey(secretBytes, saltBytes);

            } else {
                console.warn('Secret or salt bytes are missing. Room key cannot be derived.');
            }
            const messagesLog = data.logs;
            const messages = [];
            if (messagesLog && messagesLog.length > 0) {
                for (const logEntry of messagesLog) {
                    const ciphertext = new Uint8Array(logEntry.ciphertext.data);
                    const iv = new Uint8Array(logEntry.iv.data);
                    const timestamp = new Date(logEntry.created).toLocaleTimeString();
                    const plaintext = await decryptMessage(ciphertext, iv, ROOM_KEY);
                    const username = logEntry.username;
                    messages.push({ username, message: plaintext, timestamp });
                }
            }
            // sort messages by timestamp
            messages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
            for (const msg of messages) {
                const messageItem = document.createElement('li');
                messageItem.className = 'p-1 bg-skye-gray-input text-white text-[12px]';
                messageItem.innerHTML = `<b>${msg.username}:</b> ${msg.message} <span class="text-[10px] text-gray-400">(${msg.timestamp})</span>`;
                textChatMessagesList.appendChild(messageItem);
            }
            updateUserCountandList(data.users, data.numusers);
            await updatePeers(data.users);
            break;
        case 'user_change':
            updateUserCountandList(data.users, data.numusers);
            await updatePeers(data.users);
            break;
        case 'offer':
            if(!peerConnections[data.from]) {
                break;
            }
            peerConnections[data.from].receiveDescription(data.description, data.from); break;
            break;

        case 'ice-candidate':
            if(!peerConnections[data.from]) {
                break;
            }
            peerConnections[data.from].receiveIceCandidate(data.candidate, data.from);
            break;
        case 'change_displayname':

            const peer = peerConnections[data.oldName];
            if(data.oldName === displayName) {
                displayName = data.newName;
            }
            if (peer) {
                peer.peerName = data.newName;
                peerConnections[data.newName] = peer;
                delete peerConnections[data.oldName];
            }
            const url = new URL(window.location.href);
            url.searchParams.set('name', data.newName);
            window.history.replaceState({}, '', url);
            updateUserCountandList(data.users, data.numusers);
            break;
        case 'error':
            console.error('Error from server:', data.message);
            break;
        default:
            console.warn('Recieved message from server with unknown type: ' + data.type);
    }
});
