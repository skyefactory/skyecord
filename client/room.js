const displayName = new URLSearchParams(window.location.search).get('name');
const roomId = new URLSearchParams(window.location.search).get('roomId');
const muteMicButton = document.getElementById('mute-mic');
const deafenSelfButton = document.getElementById('deafen-self');
const leaveRoomButton = document.getElementById('leave-room');
const screenShareButton = document.getElementById('screen-share');
const videoButton = document.getElementById('video');
const sessionId = getStoredValue('session_id');
const signallingServerURL = 'wss://signal.skyefactory.com';
const socket = new WebSocket(signallingServerURL);
console.log(sessionId);
const joinedAudio = './audio/joined.wav';
const leftAudio = './audio/left.wav';
const startedVideoAudio = './audio/started-video.wav';
const goodByeAudio = './audio/goodbye.wav';
const mutedAudio = './audio/muted.wav';
const deafenedAudio = './audio/deafened.wav';
const unmutedAudio = './audio/unmuted.wav';
const undeafenedAudio = './audio/undeafened.wav';

const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' }
    ]
};

const constraints = {
    audio: true,
    video: false
};

let localStream = null;
let isMuted = false;
let isDeafened = false;
let isScreenSharing = false;
let numPeers = 0;
const peerConnections = {};

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

bindDialogControls(document.getElementById('self-controls'), '.self-controls-open', 'dialog', '.self-controls-close');
bindDialogControls(document.getElementById('other-controls'), '.other-controls-open', 'dialog', '.other-controls-close');

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

class Peer {
    constructor(peerName) {
        this.peerName = peerName;
        this.iceCandidateQueue = [];
        this.pc = new RTCPeerConnection(configuration);
        this.polite = displayName < peerName;
        this.makingOffer = false;
        this.ignoreOffer = false;
        this.isSettingRemoteAnswerPending = false;
        this.textChannel = this.pc.createDataChannel('text');
        this.controlChannel = this.pc.createDataChannel('control');
        this.otherVolume = 1.0;
        this.remoteStatus = { muted: false, deafened: false };

        this.controlChannel.onopen = () => {
            console.log('Control channel with ' + peerName + ' is open.');
            this.controlChannel.send(JSON.stringify({ type: 'status', muted: isMuted, deafened: isDeafened }));
        };

        this.controlChannel.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.type === 'status') {
                    console.log('Received status from ' + peerName, data);
                    this.remoteStatus = { muted: data.muted, deafened: data.deafened };
                }
            } catch (err) {
                console.error('Error parsing control channel message from ' + peerName, err);
            }
        };

        this.pc.ontrack = (event) => {
            const { track, streams } = event;

            let stream = (streams && streams.length) ? streams[0] : null;
            if (!stream) {
                stream = new MediaStream();
                stream.addTrack(track);
            }

            const trackType = track.kind;
            console.log(`Received ${trackType} track from ${peerName}`);

            if (trackType === 'audio') {
                const audioId = `audio-${peerName}`;
                let audioElement = document.getElementById(audioId);
                if (!audioElement) {
                    audioElement = document.createElement('audio');
                    audioElement.id = audioId;
                    audioElement.controls = false;
                    audioElement.hidden = true;
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
            }

            if (trackType === 'video') {
                console.log(`Received video track from ${peerName}, but video is not currently supported.`);
                playSystemSound(startedVideoAudio);
            }
        };

        this.pc.addEventListener('connectionstatechange', () => {
            if (this.pc.connectionState === 'disconnected' || this.pc.connectionState === 'failed' || this.pc.connectionState === 'closed') {
                const audioElement = document.getElementById(`audio-${peerName}`);
                if (audioElement) {
                    audioElement.srcObject = null;
                    audioElement.remove();
                }
                delete peerConnections[peerName];
            }
        });

        this.pc.onnegotiationneeded = async () => {
            try {
                this.makingOffer = true;
                if (this.pc.signalingState !== 'stable') {
                    console.log('Signaling state is not stable, skipping negotiation.');
                    return;
                }
                if (this.pc.isSettingRemoteAnswerPending) {
                    console.log('Currently setting remote answer, skipping negotiation.');
                    return;
                }
                try {
                    await this.pc.setLocalDescription();
                } catch (err) {
                    console.error('Error setting local description during negotiation.', err);
                    return;
                }
                socket.send(JSON.stringify({ type: 'offer', description: this.pc.localDescription, target: peerName, roomId: roomId, sessionId: sessionId }));
            } catch (err) {
                console.error('Error during negotiation.', err);
            } finally {
                this.makingOffer = false;
            }
        };

        this.pc.onicecandidate = ({ candidate }) => {
            if (candidate) {
                socket.send(JSON.stringify({ type: 'ice-candidate', candidate: candidate, target: peerName, roomId: roomId, sessionId: sessionId }));
            }
        };
    }

    async start() {
        try {
            if (localStream === null) {
                localStream = await navigator.mediaDevices.getUserMedia(constraints);
            }
            for (const track of localStream.getTracks()) {
                this.pc.addTrack(track, localStream);
            }
            console.log(localStream.getAudioTracks()[0].getSettings());
        } catch (err) {
            console.error('Error accessing media devices.', err);
        }
    }
}

function updatePeers(users) {
    users.forEach(user => {
        if (user !== displayName && !peerConnections[user]) {
            const peer = new Peer(user);
            peerConnections[user] = peer;
            peer.start();
        }
    });
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
        if (user === displayName) {
            listItem.textContent = user + ' (You)';
            listItem.className = 'p-1 bg-[rgb(60,60,30)] text-white font-bold ';

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

function getStoredValue(key) {
    return localStorage.getItem(key) ?? '';
}

function setStoredValue(key, value) {
    localStorage.setItem(key, value);
}

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
        console.error('Error accessing display media.', err);
    }
});

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
            updatePeers(data.users);
            break;
        case 'user_change':
            updateUserCountandList(data.users, data.numusers);
            updatePeers(data.users);
            break;
        case 'offer':
            if (data.description) {
                const peer = peerConnections[data.from];
                if (!peer) {
                    console.warn('Received offer from unknown peer', data.from);
                    break;
                }
                const readyForOffer = !peer.makingOffer && (peer.pc.signalingState === 'stable' || peer.isSettingRemoteAnswerPending);
                const offerCollision = data.description.type === 'offer' && !readyForOffer;
                peer.ignoreOffer = !peer.polite && offerCollision;
                if (peer.ignoreOffer) {
                    console.log('Ignoring offer from ' + data.from + ' due to collision and being impolite.');
                    break;
                }
                console.log('Replying to offer from ' + data.from);
                peer.isSettingRemoteAnswerPending = data.description.type === 'answer';
                await peer.pc.setRemoteDescription(data.description);
                peer.isSettingRemoteAnswerPending = false;
                peer.iceCandidateQueue.forEach(async candidate => {
                    try {
                        await peer.pc.addIceCandidate(candidate);
                    } catch (err) {
                        console.error('Error adding queued ICE candidate', err);
                    }
                });
                peer.iceCandidateQueue = [];
                if (data.description.type === 'offer') {
                    try {
                        await peer.pc.setLocalDescription();
                    } catch (err) {
                        console.error('Error setting local description for answer', err);
                    }
                    socket.send(JSON.stringify({ type: 'offer', description: peer.pc.localDescription, target: data.from, roomId: roomId, sessionId: sessionId }));
                }
                break;
            }
            break;
        case 'ice-candidate':
            if (data.candidate) {
                const peer = peerConnections[data.from];
                if (peer && peer.pc.remoteDescription) {
                    try {
                        await peer.pc.addIceCandidate(data.candidate);
                    } catch (err) {
                        console.error('Error adding remote ICE candidate', err);
                    }
                } else if (peer && !peer.pc.remoteDescription) {
                    peer.iceCandidateQueue.push(data.candidate);
                } else {
                    console.warn('Received ICE candidate for unknown peer', data.from);
                }
            }
            break;
        default:
            console.log('Recieved message from server with unknown type: ' + data.type);
    }
});

leaveRoomButton.addEventListener('click', () => {
    playSystemSound(goodByeAudio);
    socket.close(1000, 'User left the room');
});