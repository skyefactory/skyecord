import {localState, isAudioSilent, startVoiceDetectionLocal, localOnSilent, localOnSpeaking} from './roomMisc.js';
import {debugLog} from './debugLogger.js';
import {handleNewMessage, updatePeerStatus, updatePeerScreenShareButton} from './roomUi.js';
const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' }
    ]
};
const constraints = {
    audio: true,
    video: false
};


class PeerStreams{
    constructor() {
        this.microphoneAudio = null; // This is the remote microphone audio track from the peer
        this.camVideo = null; // This is the remote camera video track from the peer
        this.screenAudio = null; // This is the remote screen share audio track from the peer
        this.screenVideo = null; // This is the remote screen share video track from the peer
    }
}
class Peer {
    // Constructor
    constructor(peerName) {
        this.peerName = peerName;
        this.iceCandidateQueue = [];
        this.pc = new RTCPeerConnection(configuration);
        this.polite = localState.displayName < peerName;
        this.makingOffer = false;
        this.ignoreOffer = false;
        this.isSettingRemoteAnswerPending = false;
        this.otherVolume = 1.0;
        this.remoteStatus = { muted: false, deafened: false, screenSharing: false, video: false };
        this.remoteStreams = new PeerStreams();
        
        this.chatChannel = null;
        this.statusChannel = null;

        this.setupPeerConnectionEvents();
        this.setupDataChannels();

        this.pendingRemoteTracks = []; // tracks received before their metadata arrives
        this.pendingTrackInfos = []; // track-info messages received before the track arrives
        this.isTornDown = false;
    }

    removeTrack(trackId, trackType){
        switch(trackType) {
            case 'microphoneAudio':{
                this.remoteStreams.microphoneAudio = null;
                const audioElement = document.getElementById(`audio-${this.peerName}`);
                if (audioElement) {
                    audioElement.pause();
                    audioElement.srcObject = null;
                    audioElement.remove();
                }
                break;
            }
            case 'screenShareAudio':
                this.remoteStreams.screenAudio = null;
                debugLog('info', "Removed screen share audio track from peer " + this.peerName);
                this.pc.removeTrack(this.screenAudioSender);
                break;
            case 'screenShareVideo':
                this.remoteStreams.screenVideo = null;
                debugLog('info', "Removed screen share video track from peer " + this.peerName);
                this.pc.removeTrack(this.screenVideoSender);
                updatePeerScreenShareButton(this.peerName, false);
                break;
        }
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
            debugLog('info', ` channel [${type}] with ${this.peerName} is OPEN`);
            if (type === 'status') {
                this.sendStatusUpdate({ muted: localState.isMuted, deafened: localState.isDeafened });
            }
        };

        channel.onclose = () => {
            debugLog('info', ` channel [${type}] with ${this.peerName} is CLOSED`);
        };

        channel.onerror = (error) => {
            debugLog('warn', ` channel [${type}] error with ${this.peerName}:`, error);
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
                debugLog('error', `Failed parsing message on channel [${type}]:`, err);
            }
        };
    }

    sendChatMessage(text) {
        if (this.chatChannel && this.chatChannel.readyState === 'open') {
            this.chatChannel.send(JSON.stringify({ sender: localState.displayName, text: text, timestamp: Date.now() }));
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
        const sender = this.peerName;
        handleNewMessage(sender, message, timestamp);
    }

    handleIncomingStatus(data) {
        this.remoteStatus.muted = data.muted;
        this.remoteStatus.deafened = data.deafened;
        this.remoteStatus.screenSharing = data.screenSharing;
        this.remoteStatus.video = data.video;
        updatePeerStatus(this.peerName, this.remoteStatus);              
    }
    //Initialization
    async start() {
        try {
            //Local Microphone Stream is OUR microphone. This is what we send to the peer. This is shared across all peers.
            //Each peer will have a corresponding 'Remote Stream' which is their own microphone audio they send to us.

            if (localState.localMicrophoneStream === null) {
                localState.localMicrophoneStream = await navigator.mediaDevices.getUserMedia(constraints);
            }

            for (const track of localState.localMicrophoneStream.getTracks()) {
                this.pc.addTrack(track, localState.localMicrophoneStream);
                localState.socket.send(JSON.stringify({type: 'track-info' , track: track, stream: localState.localMicrophoneStream, roomId: localState.roomId, trackId: track.id, trackType: `microphoneAudio`, target: this.peerName}));
            }
            startVoiceDetectionLocal(localState.localMicrophoneStream, localOnSpeaking, localOnSilent);

        } catch (err) {
            alert('App was unable to access your microphone. Check if your browser is requesting permissions or if you have it blocked.')
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

    handleTrack(track, stream, trackId, trackType){
        console.log("Recieved track with ID" + trackId + " and type " + trackType + " from peer " + this.peerName);
        switch(trackType) {
            case 'microphoneAudio':{
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
                break;
            }
            case 'screenShareAudio':
                this.remoteStreams.screenAudio = stream;
                debugLog('info', "Recieved screen share audio track from peer " + this.peerName);
                break;
            case 'screenShareVideo':
                this.remoteStreams.screenVideo = stream;
                debugLog('info', "Recieved screen share video track from peer " + this.peerName);
                updatePeerScreenShareButton(this.peerName, true);
                break;
            case 'cameraVideo':
                this.remoteStreams.camVideo = stream;
                break;
            default:
                console.warn('Unknown track type received:', trackType);
        }

    }

    teardown(reason = 'peer disconnected') {
        if (this.isTornDown) {
            return;
        }
        this.isTornDown = true;

        debugLog(`Tearing down peer ${this.peerName}: ${reason}`);
        this.stopVoiceDetection();

        if (this.chatChannel) {
            this.chatChannel.onopen = null;
            this.chatChannel.onclose = null;
            this.chatChannel.onmessage = null;
            this.chatChannel.onerror = null;
            if (this.chatChannel.readyState === 'open' || this.chatChannel.readyState === 'connecting') {
                this.chatChannel.close();
            }
            this.chatChannel = null;
        }

        if (this.statusChannel) {
            this.statusChannel.onopen = null;
            this.statusChannel.onclose = null;
            this.statusChannel.onmessage = null;
            this.statusChannel.onerror = null;
            if (this.statusChannel.readyState === 'open' || this.statusChannel.readyState === 'connecting') {
                this.statusChannel.close();
            }
            this.statusChannel = null;
        }

        this.pc.ontrack = null;
        this.pc.onicecandidate = null;
        this.pc.onconnectionstatechange = null;
        this.pc.onnegotiationneeded = null;
        this.pc.ondatachannel = null;

        const audioElement = document.getElementById(`audio-${this.peerName}`);
        if (audioElement) {
            audioElement.pause();
            audioElement.srcObject = null;
            audioElement.remove();
        }

        this.pendingRemoteTracks = [];
        this.pendingTrackInfos = [];
        this.iceCandidateQueue = [];

        if (this.pc.signalingState !== 'closed') {
            this.pc.close();
        }

        if (localState.peerConnections[this.peerName] === this) {
            delete localState.peerConnections[this.peerName];
        }
    }

    onTrack(event) {
        const { track, streams } = event;
        if(!track){
            console.warn("onTrack event received without a track. Ignoring.");
            return;
        }
        let stream = (streams && streams.length) ? streams[0] : null;
        if (!stream) {
            stream = new MediaStream();
            stream.addTrack(track);
        }

        if (this.pendingTrackInfos.length > 0) {
            const trackInfo = this.pendingTrackInfos.shift();
            console.log("calling handle track w/", trackInfo);
            this.handleTrack(track, stream, track.id, trackInfo.trackType);
        } else {
            console.log("onTrack called before metadata recieved for track ID " + track.id + " from peer " + this.peerName + ". Storing track for later.");
            this.pendingRemoteTracks.push({ track, stream });
        }
        
        return;
    }

    onIceCandidate(event) {
        const candidate = event.candidate;
        if (candidate) {
            localState.socket.send(JSON.stringify({ type: 'ice-candidate', candidate: candidate, target: this.peerName, roomId: localState.roomId, sessionId: localState.sessionId }));
        }
    }
    onConnectionStateChange(){
        if (this.pc.connectionState === 'disconnected' || this.pc.connectionState === 'failed' || this.pc.connectionState === 'closed') {
            this.teardown(`pc ${this.pc.connectionState}`);
        }
    }
    async onNegotiationNeeded(){
        try {
            this.makingOffer = true;
            await this.pc.setLocalDescription();
            localState.socket.send(JSON.stringify({ type: 'offer', description: this.pc.localDescription, target: this.peerName, roomId: localState.roomId, sessionId: localState.sessionId }));
        } catch (err) {
            console.error('Error during negotiation.', err);
        } finally {
            this.makingOffer = false;
        }
    }

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
                localState.socket.send(JSON.stringify({ type: 'offer', description: this.pc.localDescription, target: from, roomId: localState.roomId, sessionId: localState.sessionId }));
            }
            return;
        }
    }
    async receiveIceCandidate(candidate){
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


export async function updatePeers(users) {
    const peersToStart = [];

    for (const user of users) {
        if (user !== localState.displayName && !localState.peerConnections[user]) {
            const peer = new Peer(user);
            localState.peerConnections[user] = peer;
            peersToStart.push(peer);
        }
    }

    await Promise.allSettled(peersToStart.map(peer => peer.start()));
}
