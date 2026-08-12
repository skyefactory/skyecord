import {debugLog} from './debugLogger.js';
import {isElectron, localState, stopVoiceDetectionLocal} from './roomMisc.js';
import {updateRoomNameID, loadMessages, updateUserList} from './roomUi.js';
import {initializeRoomKey, decryptMessage} from './roomAuth.js'; 
import {updatePeers} from './roomPeer.js';   
debugLog('info', 'room.js loaded');
debugLog('info', `isElectron: ${isElectron}`);


localState.displayName = new URLSearchParams(window.location.search).get('name');
localState.roomId = new URLSearchParams(window.location.search).get('roomId');
debugLog('info', `roomId: ${localState.roomId}`);
debugLog('info', `displayName: ${localState.displayName}`);

localState.openSocket();

localState.socket.addEventListener('open',() =>{
    localState.socket.send(JSON.stringify({type:'join', name: localState.displayName, roomId: localState.roomId, sessionId: localState.sessionId}));
    debugLog('info', 'WebSocket connection opened and join message sent');
});

localState.socket.addEventListener('close', () => {
    window.location.href = '/';
    stopVoiceDetectionLocal();
    debugLog('info', 'WebSocket connection closed, redirecting to home page');
});

localState.socket.addEventListener('message', async (event) => {
    let data;
    try {
        data = JSON.parse(event.data);
    } catch (err) {
        debugLog('error', 'Error parsing WebSocket message:', err);
        return;
    }

    switch (data.type) {
        case 'joined':
        {
            updateRoomNameID(data.roomName, localState.roomId);
            await initializeRoomKey(data.saltBytes);
            const messagesLog = data.logs;
            const messages = [];
            if (messagesLog && messagesLog.length > 0) {
                for (const logEntry of messagesLog) {
                    const ciphertext = new Uint8Array(logEntry.ciphertext.data);
                    const iv = new Uint8Array(logEntry.iv.data);
                    const timestamp = new Date(logEntry.created).toLocaleTimeString();
                    const plaintext = await decryptMessage(ciphertext, iv);
                    const username = logEntry.username;
                    messages.push({ username, message: plaintext, timestamp });
                }
            }
            loadMessages(messages);
            updateUserList(data.users, data.numusers);
            await updatePeers(data.users);
            break;
        }
        case 'user_change':
            updateUserList(data.users, data.numusers);
            await updatePeers(data.users);
            break;
        case 'offer':
            if(!localState.peerConnections[data.from]) {
                break;
            }
            localState.peerConnections[data.from].receiveDescription(data.description, data.from);
            break;

        case 'ice-candidate':
            if(!localState.peerConnections[data.from]) {
                break;
            }
            localState.peerConnections[data.from].receiveIceCandidate(data.candidate, data.from);
            break;
        case 'change_displayname':{

            const peer = localState.peerConnections[data.oldName];
            if(data.oldName === localState.displayName) {
                localState.displayName = data.newName;
            }
            if (peer) {
                peer.peerName = data.newName;
                localState.peerConnections[data.newName] = peer;
                delete localState.peerConnections[data.oldName];
            }
            const url = new URL(window.location.href);
            url.searchParams.set('name', data.newName);
            window.history.replaceState({}, '', url);
            updateUserList(data.users, data.numusers);
            break;
        }
        case 'error':
            debugLog('error', 'Error message from server:', data.message);
            break;
        
        case 'track-info':{
            const trackId = data.trackId;
            const trackType = data.trackType;
            const from = data.from;
            const peerFrom = localState.peerConnections[from];
            if (peerFrom){
                 debugLog('info', "Recieved track info from server for track ID " + data.trackId + " from peer " + data.from);
                if(peerFrom.pendingRemoteTracks.length > 0){
                    debugLog('info', "ontrack was called before metadata recieved for track ID " + data.trackId + " from peer " + data.from);
                    const pendingTrack = peerFrom.pendingRemoteTracks.shift();
                    peerFrom.handleTrack(pendingTrack.track, pendingTrack.stream, trackId, trackType);
                } else {
                    debugLog('info', "ontrack has not been called yet for track ID " + data.trackId + " from peer " + data.from + " with type " + data.trackType + ". Storing track info for later.");
                    peerFrom.pendingTrackInfos.push({ trackId: trackId, trackType: trackType });
                }
            }
            break;
        }
        default:
            debugLog('warn', 'Recieved message from server with unknown type: ' + data.type);
    }
});