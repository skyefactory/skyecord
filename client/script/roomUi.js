import {debugLog} from './debugLogger.js';
import {localState, setStoredValue} from './roomMisc.js';
import {ROOM_KEY, encryptMessage} from './roomAuth.js';
const applicationAudio = {
    joined: '../audio/joined.wav',
    left: '../audio/left.wav',
    startedVideo: '../audio/started-video.wav',
    goodbye: '../audio/goodbye.wav',
    muted: '../audio/muted.wav',
    deafened: '../audio/deafened.wav',
    unmuted: '../audio/unmuted.wav',
    undeafened: '../audio/undeafened.wav',
}

const muteMicButton = document.getElementById('mute-mic');
const deafenButton = document.getElementById('deafen-self');
const leaveRoomButton = document.getElementById('leave-room');
const screenShareButton = document.getElementById('screen-share');
const videoButton = document.getElementById('video');
const textChatInput = document.getElementById('text-chat-input');
const textChatSendButton = document.getElementById('text-chat-send');
const textChatMessagesList = document.getElementById('text-chat-messages');
const textChatContainer = document.getElementById('text-chat-container');

export function loadMessages(messages){
    messages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    for (const msg of messages) {
        const messageItem = document.createElement('li');
        messageItem.className = 'p-1 bg-skye-gray-input text-white text-[12px]';
        messageItem.innerHTML = `<b>${msg.username}:</b> ${msg.message} <span class="text-[10px] text-gray-400">(${msg.timestamp})</span>`;
        textChatMessagesList.appendChild(messageItem);
    }
}

export function updateRoomNameID(roomname, roomid){
    document.getElementById('room-name').textContent = roomname;
    document.getElementById('room-id').textContent = roomid;
}

/*
 * Plays the audio path provided in the audio parameter on the 'application' audo element.
 *      params:
 *          audio - The path to the audio file to be played.
 */

async function playApplicationAudio(audio){
    const audioElement = document.getElementById('application');

    if (!audioElement || !audio) {
        debugLog('warn', 'playApplicationAudio: audioElement or audio is null, aborting. Check the path provided.');
        return;
    }

    try{
        audioElement.pause();
        if(audioElement.src !== audio){
            audioElement.src = audio;
        }
        audioElement.currentTime = 0;
        await audioElement.play();
    } catch(error){
        debugLog('error', 'playApplicationAudio: error playing audio', error);
    }
}

/*
 * Binds the open and close controls for a dialog element.
 *      params:
 *          root - The root element containing the dialog and controls.
 *          openSelector - The selector for the button that opens the dialog.
 *          dialogSelector - The selector for the dialog element.
 *          closeSelector - The selector for the button that closes the dialog.
 */

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

/*
 * updates the call controls to only be available when there are other peers in the room.
 */

function updateControlAvailability() {
    screenShareButton.disabled = localState.numPeers === 0;
    screenShareButton.style.opacity = localState.numPeers === 0 ? 0.5 : 1;
    
    videoButton.disabled = localState.numPeers === 0;
    videoButton.style.opacity = localState.numPeers === 0 ? 0.5 : 1;

    muteMicButton.disabled = localState.numPeers === 0;
    muteMicButton.style.opacity = localState.numPeers === 0 ? 0.5 : 1;

    deafenButton.disabled = localState.numPeers === 0;
    deafenButton.style.opacity = localState.numPeers === 0 ? 0.5 : 1;
}

/*
 * updates the user list in the UI based on the provided users array and number of users. also plays sfx when users join or leave the room.
 *      params:
 *          users - An array of user display names currently in the room.
 *          numusers - The total number of users currently in the room.
 */

export function updateUserList(users, numusers){
    const newRoomUsers = new Set(users);
    for (const user of localState.currentRoomUsers) {
        if (user !== localState.displayName && !newRoomUsers.has(user) && localState.peerConnections[user]) {
            localState.peerConnections[user].teardown('user removed from room list');
        }
    }
    localState.currentRoomUsers = newRoomUsers;

    if (numusers > localState.numPeers + 1){
        playApplicationAudio(applicationAudio.joined);
        debugLog('info', 'A new user has joined the room');
    }

    else if (numusers < localState.numPeers + 1){
        playApplicationAudio(applicationAudio.left);
        debugLog('info', 'A user has left the room');
    }
    
    localState.numPeers = numusers - 1;
    updateControlAvailability();
    document.getElementById('room-status').style.display = 'block';
    document.getElementById('user-count').textContent = numusers + (numusers === 1 ? ' user' : ' users');

    const userList = document.getElementById('user-list');
    userList.innerHTML = '';
    users.forEach(user => {
        const listItem = document.createElement('li');
        listItem.id = 'userlist-' + user;
        if (user === localState.displayName) {
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
                            if(newNickname && newNickname !== localState.displayName  && newNickname !== '') {
                                localState.socket.send(JSON.stringify({ type: 'update-displayname', oldName: localState.displayName, newName: newNickname, roomId: localState.roomId, sessionId: localState.sessionId }));
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

/*
 * updates the mute and deafen indicators for a specific peer in the user list.
 *      params:
 *          peerName - The display name of the peer whose status is to be updated.
 *          status - An object containing the mute and deafen status of the peer.
 */
export function updatePeerStatus(peerName, status) {
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


export function handleNewMessage(sender, message,timestamp){
    if (message && message.length > 0) {
        const messageItem = document.createElement('li');
        messageItem.className = 'p-1 bg-skye-gray-input text-white text-[12px]';
        messageItem.innerHTML = `<b>${sender}:</b> ${message} <span class="text-[10px] text-gray-400">(${timestamp})</span>`;
        textChatMessagesList.appendChild(messageItem);
        textChatContainer.scrollTop = textChatContainer.scrollHeight;
    }
}


leaveRoomButton.addEventListener('click', () => {
    playApplicationAudio(applicationAudio.goodbye);
    for (const peerName in localState.peerConnections) {
        localState.peerConnections[peerName].teardown('user left the room');
    }
    localState.socket.close(1000, 'User left the room');
});

muteMicButton.addEventListener('click', () => {
    if (localState.localMicrophoneStream) {
        localState.isMuted = !localState.isMuted;
        localState.localMicrophoneStream.getAudioTracks().forEach(track => {
            track.enabled = !localState.isMuted;
        });
        muteMicButton.innerHTML = localState.isMuted
            ? '<img src="./svgicons/mic_off.svg" alt="Unmute Microphone">'
            : '<img src="./svgicons/mic.svg" alt="Mute Microphone">';
        playApplicationAudio(localState.isMuted ? applicationAudio.muted : applicationAudio.unmuted);
        for (const peerName in localState.peerConnections) {
            localState.peerConnections[peerName].sendStatusUpdate({ muted: localState.isMuted, deafened: localState.isDeafened });
        }
    }
});

deafenButton.addEventListener('click', () => {
    localState.isDeafened = !localState.isDeafened;
    const audioElements = document.querySelectorAll('audio');
    audioElements.forEach(audio => {
        if (audio.id !== 'application') {
            audio.muted = localState.isDeafened;
        }
    });
    deafenButton.innerHTML = localState.isDeafened
        ? '<img src="./svgicons/media_output_off.svg" alt="Un-deafen Self">'
        : '<img src="./svgicons/media_output.svg" alt="Deafen Self">';
    playApplicationAudio(localState.isDeafened ? applicationAudio.deafened : applicationAudio.undeafened);
    for (const peerName in localState.peerConnections) {
        localState.peerConnections[peerName].sendStatusUpdate({ muted: localState.isMuted, deafened: localState.isDeafened });
    }
});


textChatInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
        event.preventDefault(); // Prevent default behavior if inside a form
        textChatSendButton.click();   // Reuse your existing send button logic
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
        for (const peerName in localState.peerConnections) {
            localState.peerConnections[peerName].sendChatMessage(message);
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
                const logMessage = JSON.stringify({ type: 'log', message: encryptedMessage.encrypted, iv: encryptedMessage.iv, timestamp: Date.now(), roomId: localState.roomId, sessionId: localState.sessionId });
                localState.socket.send(logMessage);
            }).catch(err => {
                console.error('Error encrypting message for logging:', err);
            });
        } else {
            debugLog('warn', 'ROOM_KEY is not available. Message will not be logged.');
        }
    }
});
bindDialogControls(document.getElementById('self-controls'), '.self-controls-open', 'dialog', '.self-controls-close');
bindDialogControls(document.getElementById('other-controls'), '.other-controls-open', 'dialog', '.other-controls-close');