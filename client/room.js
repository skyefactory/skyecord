/******************************************************** 
 * Constants
********************************************************/
//Url parameters

const displayName = new URLSearchParams(window.location.search).get('name');
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

//Auth
const sessionId = getStoredValue('session_id');


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

let localStream = null;
let isMuted = false;
let isDeafened = false;
let isScreenSharing = false;
let numPeers = 0;
let micTrack = null;
let screenAudioTrack = null;
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
    for(peerName in peerConnections) {
        console.log('Checking peer connection for', peerName);
    };
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
        if (user === displayName) {
            listItem.textContent = user + ' (You)';
            listItem.className = 'p-1 bg-[rgb(60, 60, 30)] text-white font-bold ';

            const selfControls = document.getElementById('self-controls');
            const controlsInstance = selfControls.cloneNode(true);
            if (controlsInstance) {
                controlsInstance.style.display = 'inline';
                bindDialogControls(controlsInstance, '.self-controls-open', 'dialog', '.self-controls-close');
                listItem.appendChild(controlsInstance);
            }
        } else {
            listItem.className = 'p-1 bg-skye-gray-input text-white w-[75%]';
            listItem.textContent = user;
        }
        userList.appendChild(listItem);
    });
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


function getStoredValue(key) {
    return localStorage.getItem(key) ?? '';
}

function setStoredValue(key, value) {
    localStorage.setItem(key, value);
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

class Peer {
    //Constructor
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
        this.setupPeerConnectionEvents();
        this.trackMetadata = {};
    }
    //Initialization
    async start() {
        try {
            if (localStream === null) {
                localStream = await navigator.mediaDevices.getUserMedia(constraints);
            }

            console.log("Adding tracks:", localStream.getTracks());
            micTrack = localStream.getAudioTracks()[0];

            for (const track of localStream.getTracks()) {
                this.pc.addTrack(track, localStream);

                if (track.kind === 'audio') {
                    socket.send(JSON.stringify({
                        type: "track-info",
                        target: this.peerName,
                        roomId,
                        sessionId,
                        trackId: track.id,
                        mediaType: "microphone"
                    }));
                }
            }

            console.log(localStream.getAudioTracks()[0].getSettings());
        } catch (err) {
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
        const type = this.trackMetadata[track.id];
        if (trackType === 'audio') {
            if (type === 'microphone') {
                console.log(`Received microphone track from ${this.peerName}`);
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

            } else if (type === 'screen-audio') {
                console.log(`Received screen audio track from ${this.peerName}`);
            } else {
                console.log(`Received unknown audio track type from ${this.peerName}`);
            }
            
        }

        if (trackType === 'video') {
            console.log(`Received video track from ${this.peerName}, but video is not currently supported.`);
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
        console.log(
            this.peerName,
            "connection:",
            this.pc.connectionState,
            "ice:",
            this.pc.iceConnectionState
        );
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
        console.log(this.peerName + ' is speaking');
    }

    onSilent(){
        if(!this.isSpeaking) return;
        this.isSpeaking = false;
        console.log(this.peerName + ' is silent');
    }

    //Socket calls
    async receiveDescription(description, from){
    if (description) {
            const readyForOffer = !this.makingOffer && (this.pc.signalingState === 'stable' || this.isSettingRemoteAnswerPending);
            const offerCollision = description.type === 'offer' && !readyForOffer;
            this.ignoreOffer = !this.polite && offerCollision;
            if (this.ignoreOffer) {
                console.log('Ignoring offer from ' + from + ' due to collision and being impolite.');
                return;
            }
            console.log('Replying to offer from ' + from);
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
    socket.close(1000, 'User left the room');
});

muteMicButton.addEventListener('click', () => {
    if (localStream) {
        isMuted = !isMuted;
        localStream.getAudioTracks().forEach(track => {
            track.enabled = !isMuted;
        });
        muteMicButton.innerHTML = isMuted
            ? '<img src="./svgicons/mic_off.svg" alt="Unmute Microphone">'
            : '<img src="./svgicons/mic.svg" alt="Mute Microphone">';
        playSystemSound(isMuted ? mutedAudio : unmutedAudio);
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
});

async function startWindowShare(windowSource){
    try{
        window.electronScreenShare.setTargetSource(windowSource.id);

        const stream = await navigator.mediaDevices.getDisplayMedia({
            audio: true,
            video:{
                width: { ideal: 1920 },
                height: { ideal: 1080 },
                frameRate: { ideal: 30 }
            }
        });

        const screenTrack = stream.getVideoTracks()[0];
        
        const audioTrack = stream.getAudioTracks()[0]; 

        for (const peerName in peerConnections) {
            const peer = peerConnections[peerName];
            const pc = peer.pc;
            
            const videoSender = pc.getSenders().find(sender => sender.track?.kind === 'video');

            if (videoSender) {
                videoSender.replaceTrack(screenTrack);   
            } else {
                pc.addTrack(screenTrack, stream);
            }
            screenAudioTrack = audioTrack;

            if (audioTrack) {
                const audioSender = pc.getSenders().find(sender => sender.track && sender.track.kind === 'audio' && sender.track === micTrack); 
                
                if (audioSender) {
                     audioSender.replaceTrack(audioTrack);
                } else {
                     pc.addTrack(audioTrack, stream);
                }

                socket.send(JSON.stringify({
                    type: "track-info",
                    target: peerName,
                    roomId,
                    sessionId,
                    trackId: audioTrack.id,
                    mediaType: "screen-audio"
                }));
            }
         }
         isScreenSharing = true;
    }
    catch(err){
        console.error('Error accessing display media.', err);
    }
}

function selectWindowSourceUI() {
  return new Promise((resolve, reject) => {
    const modal = document.getElementById('screen-picker-modal');
    const grid = document.getElementById('picker-sources-grid');
    const closeBtn = document.getElementById('close-picker-btn');

    grid.innerHTML = '';
    
    modal.classList.remove('hidden');
    modal.classList.add('flex');

    window.electronScreenShare.getSources().then(sources => {
      sources.forEach(source => {
        const item = document.createElement('div');

        item.className = 'bg-[#202225] p-3 rounded-md text-center cursor-pointer transition-all duration-150 hover:bg-[#34373c] hover:scale-[1.02] border border-transparent hover:border-indigo-500/30 group';

        item.innerHTML = `
          <div class="w-full h-20 bg-black/40 rounded flex items-center justify-center overflow-hidden mb-2 border border-white/5 group-hover:border-white/10">
            <img src="${source.thumbnail.toDataURL()}" class="w-full h-full object-contain" />
          </div>
          <div class="text-xs text-[#dcddde] group-hover:text-white truncate font-medium px-1">${source.name}</div>
        `;

        item.addEventListener('click', () => {
          modal.classList.add('hidden');
          modal.classList.remove('flex');
          resolve(source); 
        });

        grid.appendChild(item);
      });
    }).catch(reject);

    // Structural closure handlers
    const cleanUpAndClose = () => {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
      reject(new Error('User cancelled screen share picker.'));
    };

    closeBtn.onclick = cleanUpAndClose;
    modal.onclick = (e) => { if(e.target === modal) cleanUpAndClose(); };
  });
}

screenShareButton.addEventListener('click', async () => {
    try {
        const chosenSource = await selectWindowSourceUI();
        
        await startWindowShare(chosenSource);
    } catch (err) {
        console.log(err.message);
    }
});

/******************************************************** 
 * Websocket events
********************************************************/

socket.addEventListener('open', () => {
    console.log('Connected to the signalling server');
    const nameRoomMessage = JSON.stringify({ type: 'join', name: displayName, roomId: roomId, sessionId: sessionId });
    socket.send(nameRoomMessage);
});

socket.addEventListener('close', (event) => {
    console.log('Disconnected from the signalling server.' + event.reason);
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
        case 'track-info':
            peerConnections[data.from].trackMetadata[data.trackId] = data.mediaType;
            break;
        default:
            console.log('Recieved message from server with unknown type: ' + data.type);
    }
});

