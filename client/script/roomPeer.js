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

/* class that contains information about the remote streams from a peer.*/
class PeerStreams{
    constructor() {
        this.microphoneAudio = null; // This is the remote microphone audio track from the peer
        this.camVideo = null; // This is the remote camera video track from the peer
        this.screenAudio = null; // This is the remote screen share audio track from the peer
        this.screenVideo = null; // This is the remote screen share video track from the peer
    }
}
/* class that creates, manages, and cleans up peer connections with other users in the room.
 * responsible for handling incoming and outgoing tracks, data channels, and ICE candidates.
 */
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

    /* removes a track from the peer's remote streams.
     *      params:
     *          trackId - The ID of the track to remove.
     *          trackType - The type of the track to remove.
     */
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
                debugLog('info', "screenAudioSender: ", this.screenAudioSender);
                if(this.screenAudioSender){this.pc.removeTrack(this.screenAudioSender);}
                break;
            case 'screenShareVideo':
                this.remoteStreams.screenVideo = null;
                debugLog('info', "Removed screen share video track from peer " + this.peerName);
                debugLog('info', "screenVideoSender: ", this.screenVideoSender);
                if(this.screenVideoSender){this.pc.removeTrack(this.screenVideoSender);}
                updatePeerScreenShareButton(this.peerName, false);
                break;
        }
    }
    /* sets up data channels for chat and status updates between peers.
     * If the peer is not polite, it creates the channels. If the peer is polite, it listens for incoming channels.
     */
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
    /* binds event handlers to a data channel for chat or status updates.
     *      params:
     *          channel - The RTCDataChannel to bind events to.
     *          type - The type of the channel ('chat' or 'status').
     */
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
    /* sends a chat message to the peer over the chat data channel.
     *      params:
     *          text - The plaintext message to send.
     */
    sendChatMessage(text) {
        if (this.chatChannel && this.chatChannel.readyState === 'open') {
            this.chatChannel.send(JSON.stringify({ sender: localState.displayName, text: text, timestamp: Date.now() }));
        }
    }
    /* sends a status update to the peer over the status data channel.
     *      params:
     *          statusObj - An object containing the status information to send (e.g., muted, deafened, screenSharing).
     */
    sendStatusUpdate(statusObj) {
        if (this.statusChannel && this.statusChannel.readyState === 'open') {
            this.statusChannel.send(JSON.stringify(statusObj));
        }
    }
    /* handles an incoming chat message from the peer and updates the UI accordingly.
     *      params:
     *          data - An object containing the chat message data (sender, text, timestamp).
     */
    handleIncomingChat(data) {
        const message = data.text.trim();
        const timestamp = new Date(data.timestamp).toLocaleTimeString();
        const sender = this.peerName;
        handleNewMessage(sender, message, timestamp);
    }
    /* handles an incoming status update from the peer and updates the UI accordingly.
     *      params:
     *          data - An object containing the status information (muted, deafened, screenSharing, video).
     */
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

    /* sets up the event handlers for the peer connection.
     */
    setupPeerConnectionEvents(){
        this.pc.ontrack  = (e) => this.onTrack(e);
        this.pc.onicecandidate = (e) => this.onIceCandidate(e);
        this.pc.onconnectionstatechange = () => this.onConnectionStateChange();
        this.pc.onnegotiationneeded = () => this.onNegotiationNeeded();
    }
    /* handles an incoming track from the peer and adds it to the appropriate remote stream based on its type.
     *      params:
     *          track - The MediaStreamTrack received from the peer.
     *          stream - The MediaStream associated with the track.
     *          trackId - The ID of the received track.
     *          trackType - The type of the received track (e.g., 'microphoneAudio', 'screenShareAudio', 'screenShareVideo', 'cameraVideo').
     */
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
                debugLog('info', "Recieved screen share audio stream from peer " + this.peerName);
                break;
            case 'screenShareVideo':
                this.remoteStreams.screenVideo = stream;
                debugLog('info', "Recieved screen share video stream from peer " + this.peerName);
                updatePeerScreenShareButton(this.peerName, true);
                break;
            case 'cameraVideo':
                this.remoteStreams.camVideo = stream;
                break;
            default:
                console.warn('Unknown track type received:', trackType);
        }

    }
    /* this function cleans up the peer connection, data channels, and associated resources when the peer disconnects or the connection is closed.
     *      params:
     *          reason - A string indicating the reason for the teardown (default is 'peer disconnected').
     */
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
    /* event handler for when a new track is recieved from the peer.
     *     params:
     *         event - The RTCTrackEvent containing the track and associated streams.
     */
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
    /* event handler for when a new ICE candidate is generated by the peer connection.
     *      params:
     *          event - The RTCPeerConnectionIceEvent containing the candidate.
     */
    onIceCandidate(event) {
        const candidate = event.candidate;
        if (candidate) {
            localState.socket.send(JSON.stringify({ type: 'ice-candidate', candidate: candidate, target: this.peerName, roomId: localState.roomId, sessionId: localState.sessionId }));
        }
    }
    /* event handler for when the connection state of the peer connection changes. If the connection is disconnected, failed, or closed, it triggers a teardown of the peer connection.
     */
    onConnectionStateChange(){
        if (this.pc.connectionState === 'disconnected' || this.pc.connectionState === 'failed' || this.pc.connectionState === 'closed') {
            this.teardown(`pc ${this.pc.connectionState}`);
        }
    }
    /* event handler for when negotiation is needed for the peer connection. It creates an offer and sends it to the peer.
     */
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
    /* stops voice detection for the peer's remote microphone stream
     *      params:
     *          stream - The MediaStream from the peer's microphone.
     */

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
    /* starts voice detection for the peer's remote microphone stream
     *      params:
     *          stream - The MediaStream from the peer's microphone.
     */
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
    /* callback function for when the peer is detected to be speaking. Updates the UI to indicate speaking status.
     */
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
    /* callback function for when the peer is detected to be silent. Updates the UI to indicate silent status.
     */
    onSilent(){
        if(!this.isSpeaking) return;
        const userListItem = document.getElementById('userlist-' + this.peerName);
        if (userListItem) {
            userListItem.classList.add('bg-skye-gray-input');
            userListItem.style.backgroundColor = '';
        }
        this.isSpeaking = false;
    }

    /* receives a session description from the peer and sets it as the remote description for the peer connection. If it's an offer, it creates an answer and sends it back to the peer.
     *      params:
     *          description - The RTCSessionDescription received from the peer.
     *          from - The username of the peer sending the description.
     */
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
    /* receives an ICE candidate from the peer and adds it to the peer connection. If the remote description is not set yet, it queues the candidate for later.
     *      params:
     *          candidate - The RTCIceCandidate received from the peer.
     */
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

/* updates the list of peer connections based on the current users in the room. It creates new Peer instances for new users and starts the connection process.
 *      params:
 *          users - An array of usernames currently in the room.
 */
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

    // If we are currently screensharing, we need to add the screen share tracks to the new peer connections
    if(localState.isScreenSharing && localState.localScreenVideoStream && peersToStart.length > 0) {
        debugLog('info', "Adding screen share tracks to new peer connections");
        if(localState.localScreenAudioStream && localState.localScreenVideoStream){
            const screenTrack = localState.localScreenVideoStream.getVideoTracks()[0];
            const audioTrack = localState.localScreenAudioStream.getAudioTracks()[0];
            if(audioTrack && screenTrack){
                for (const peer of peersToStart) {
                    const screenAudioSender = peer.pc.addTrack(audioTrack);
                    peer.screenAudioSender = screenAudioSender;
                    localState.socket.send(JSON.stringify({type: 'track-info' , track: audioTrack, stream: localState.localScreenAudioStream, roomId: localState.roomId, trackId: audioTrack.id, trackType: `screenShareAudio`, target: peer.peerName}));

                    const screenVideoSender = peer.pc.addTrack(screenTrack);
                    peer.screenVideoSender = screenVideoSender;
                    localState.socket.send(JSON.stringify({type: 'track-info' , track: screenTrack, stream: localState.localScreenVideoStream, roomId: localState.roomId, trackId: screenTrack.id, trackType: `screenShareVideo`, target: peer.peerName}));
                }
            }
        }
    }
}