import {debugLog} from './debugLogger.js';
import {isElectron, localState, stopVoiceDetectionLocal} from './roomMisc.js';
import {updateRoomNameID, loadMessages, updateUserList, handleNewFileMessage} from './roomUi.js';
import {initializeRoomKey, decryptMessage, decryptData} from './roomAuth.js'; 
import {updatePeers} from './roomPeer.js';   
debugLog('info', 'room.js loaded');
debugLog('info', `isElectron: ${isElectron}`);

function base64ToUint8Array(base64) {
    const binary = atob(base64);

    return Uint8Array.from(
        binary,
        c => c.charCodeAt(0)
    );
}

const fileServ = 'https://file.skyefactory.com';


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
    window.location.href = './index.html';
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
            await initializeRoomKey(base64ToUint8Array(data.saltBytes));

            const textChatLogs = data.logs.textChatRows;
            const mediaLogs = data.logs.mediaRows;
            const fileLogs = data.logs.fileRows;
            const textMessages = [];
            if (textChatLogs && textChatLogs.length > 0) {
                for (const logEntry of textChatLogs) {
                    const ciphertext = new Uint8Array(logEntry.ciphertext.data);
                    const iv = new Uint8Array(logEntry.iv.data);
                    const timestamp = logEntry.created
                    const plaintext = await decryptMessage(ciphertext, iv);
                    const username = logEntry.username;
                    textMessages.push({ username, message: plaintext, timestamp });
                }
            }
            console.log('Text messages:', textMessages);
            const mediaMessages = [];
            if (mediaLogs && mediaLogs.length > 0) {
                for (const logEntry of mediaLogs) {
                    const filepath = logEntry.filepath;
                    const filetype = logEntry.filetype;
                    const iv = new Uint8Array(logEntry.iv.data);
                    const timestamp = logEntry.created;
                    const username = logEntry.username;
                    mediaMessages.push({ username, message: filepath, timestamp, iv, filetype });
                }
            }
            const fileMessages = [];
            if (fileLogs && fileLogs.length > 0) {
                for (const logEntry of fileLogs) {
                    const filepath = logEntry.filepath;
                    const fileurl = 'https://file.skyefactory.com/' + filepath + '?roomId=' + localState.roomId + '&sessionId=' + localState.sessionId;
                    const username = logEntry.username;
                    const filename = filepath.split('/').pop();
                    const fileType = logEntry.filetype;
                    const iv = logEntry.iv;
                    const timestamp = logEntry.created;
                    fileMessages.push({ username, message: { name: filename, type: fileType, iv: iv }, url: fileurl, timestamp });
                }
            }

            // fetch the media files from the server.
            for (const mediaMessage of mediaMessages) {
                try {
                    const response = await fetch(
                        `${fileServ}${mediaMessage.message}?roomId=${localState.roomId}&sessionId=${localState.sessionId}`
                    );

                    if (!response.ok) {
                        throw new Error(`HTTP error! status: ${response.status}`);
                    }

                    const blob = await response.blob();
                    const encryptedData = await blob.arrayBuffer();

                    const decryptedData = await decryptData(
                        encryptedData,
                        mediaMessage.iv
                    );

                    const decryptedBlob = new Blob(
                        [decryptedData],
                        { type: mediaMessage.filetype }
                    );

                    mediaMessage.blobUrl =
                        URL.createObjectURL(decryptedBlob);

                    mediaMessage.fileName =
                        mediaMessage.message.split('/').pop();

                } catch (error) {
                    console.error(
                        `Error processing media ${mediaMessage.message}:`,
                        error
                    );
                }
            }

            loadMessages({ textMessages, mediaMessages, fileMessages });
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

        case 'track-removed':{
            const trackId = data.trackId;
            const from = data.from;
            const peerFrom = localState.peerConnections[from];
            const trackType = data.trackType;
            if (peerFrom){
                debugLog('info', "Recieved track removed info from server for track ID " + data.trackId + " from peer " + data.from);
                peerFrom.removeTrack(trackId, trackType);
            }
            break;
        }
        case 'fileurl':{
            const fileUrl = data.url+'?roomId=' + localState.roomId + '&sessionId=' + localState.sessionId;
            const fileName = data.fileMeta.fileName;
            const fileType = data.fileMeta.fileType;
            const iv = data.iv;
            const timestamp = Date.now();
            debugLog('info', 'Recieved file URL from server: ' + fileUrl + ' for file: ' + fileName + ' of type: ' + fileType);
            handleNewFileMessage(data.from === localState.displayName ? 'You' : data.from, { name: fileName, type: fileType, iv: iv }, fileUrl, timestamp);
            break;
        }

        default:
            debugLog('warn', 'Recieved message from server with unknown type: ' + data.type);
    }
});

