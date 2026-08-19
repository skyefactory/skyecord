/*
 * retrieves the value associated with the given key from localStorage.
 *      params:
 *          key - The key whose value is to be retrieved.
 */
 function getStoredValue(key) {
    return localStorage.getItem(key) ?? '';
}

/*
 * sets the value associated with the given key in localStorage.
 *      params:
 *          key - The key whose value is to be set.
 *          value - The value to be set for the given key.
 */
 function setStoredValue(key, value) {
    localStorage.setItem(key, value);
}

const isElectron = window.electronAPI?.isElectron || false;

const logonForm = document.getElementById('login-form');
const newRoomForm = document.getElementById('new-room-form');
const newJoinForm = document.getElementById('new-join-form');
const quickJoin = document.getElementById('quick-join');
const joinForm = document.getElementById('join-form');
const errorMsg = document.getElementById('error-msg');
const roomDeletedSFX = isElectron ? './audio/deleted.wav' : '../audio/deleted.wav';
let errorMsgTimeoutId = null;
let warnedUserNoSecret = false;
const logonApi = 'https://auth.skyefactory.com/login';
const verifySessionApi = 'https://auth.skyefactory.com/verify-session';
const createRoomApi = 'https://auth.skyefactory.com/room';


/*
 * copies the text from a specified element to the clipboard and updates the button text. Resets the button text after 2 seconds.
 *      params:
 *          buttonId - The ID of the button that triggers the copy action.
 *          textId - The ID of the element containing the text to be copied.
 *          buttonDefaultText - The default text for the button
 */
function copyText(buttonId, textId, buttonDefaultText = 'Copy Room ID') {
    const textElement = document.getElementById(textId);
    const textToCopy = textElement.textContent;

    navigator.clipboard.writeText(textToCopy).then(() => {
        const button = document.getElementById(buttonId);
        button.textContent = 'Copied!';
        setTimeout(() => {
            button.textContent = buttonDefaultText;
        }, 2000);
    }).catch(err => {
        console.error('Failed to copy text: ', err);
    });
}
/*
 * sets the error message text and sets a timeout to clear after 3 seconds. If a new error message is set before the timeout, the previous timeout is cleared.
 *      params:
 *          message - The error message to be displayed.
 */
function setErrorMessage(message) {
    errorMsg.textContent = message;
    if (errorMsgTimeoutId) {
        clearTimeout(errorMsgTimeoutId);
        errorMsgTimeoutId = null;
    }

    if (message) {
        errorMsgTimeoutId = setTimeout(() => {
            errorMsg.textContent = '';
            errorMsgTimeoutId = null;
        }, 3000);
    }
}


/*
 * checks if the user is authenticated by verifying their sessionID stored in localstorage. 
 */
async function isAuthenticated() {
    const sessionId = getStoredValue('session_id');
    if (!sessionId) {
    
        return false;
    }

    try {
        const response = await fetch(verifySessionApi, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ sessionId })
        });
        const data = await response.json();
        return !!data.user;
    } catch (error) {
        console.error('Error verifying session:', error);
        return false;
    }
}

/* utility function to quickly show or hide the new join form and quick join button */
function setNewJoinVisibility(isVisible) {
    if(isVisible){
        newJoinForm.classList.remove("hidden");
        quickJoin.classList.remove("hidden");
    } else{
        newJoinForm.classList.add("hidden");
        quickJoin.classList.add("hidden");
    }
}
/* utility function to quickly return to the create / join room screen*/
function goBackToHome() {
    setErrorMessage('');
    newRoomForm.classList.add("hidden");
    joinForm.classList.add("hidden");
    document.getElementById('room-created-screen').classList.add("hidden");
    setNewJoinVisibility(true);
}

/* creates the delete room modal for a given room  and returns the element */
function createDeleteRoomControls(ownRoom, sessionId) {
    const deleteControls = document.createElement('div');
    deleteControls.style.display = 'inline';

    const openButton = document.createElement('button');
    openButton.type = 'button';
    openButton.className = 'p-1 text-[12px] bg-skye-gray-dark text-white cursor-pointer hover:bg-skye-gray-hover';

    const openIcon = document.createElement('img');
    openIcon.src = './svgicons/delete.svg';
    openIcon.alt = 'Delete Room';
    openButton.appendChild(openIcon);

    const dialog = document.createElement('dialog');
    dialog.className = 'bg-skye-gray-dark text-white mx-auto';
    dialog.style.margin = 'auto';

    const title = document.createElement('h2');
    title.className = 'text-[16px] mb-2.5';
    title.textContent = 'Confirm Delete';

    const warning = document.createElement('p');
    warning.className = 'text-[14px] mb-2.5';
    warning.textContent = 'Are you sure you want to delete this room?';

    const warning2 = document.createElement('p');
    warning2.className = 'text-[14px] mb-2.5';
    warning2.textContent = 'If any users are in the room, they will be kicked out.';

    const confirmButton = document.createElement('button');
    confirmButton.type = 'button';
    confirmButton.className = 'w-[90%] p-2.5 ml-5 text-[16px] bg-skye-gray-dark text-white cursor-pointer hover:bg-skye-gray-hover';
    confirmButton.textContent = 'Delete';

    const spacer1 = document.createElement('br');
    const spacer2 = document.createElement('br');

    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'w-[90%] p-2.5 ml-5 text-[16px] bg-skye-gray-dark text-white cursor-pointer hover:bg-skye-gray-hover';
    cancelButton.textContent = 'Cancel';

    openButton.addEventListener('click', () => dialog.showModal());
    cancelButton.addEventListener('click', () => dialog.close());

    confirmButton.addEventListener('click', async () => {
        const deleteResponse = await fetch('https://auth.skyefactory.com/room', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                operation: 'delete',
                roomName: ownRoom.roomName,
                roomId: ownRoom.roomId,
                sessionId
            })
        });

        if (deleteResponse.ok) {
            const deleteData = await deleteResponse.json();
            if (deleteData.success) {
                const audio = new Audio(roomDeletedSFX);
                audio.play();
                setErrorMessage('Room deleted successfully.');
                dialog.close();
                loadFavorites();
            } else {
                setErrorMessage(deleteData.message || 'Failed to delete room.');
            }
        } else {
            setErrorMessage('Failed to delete room. Server error.');
        }
    });

    dialog.appendChild(title);
    dialog.appendChild(warning);
    dialog.appendChild(warning2);
    dialog.appendChild(confirmButton);
    dialog.appendChild(spacer1);
    dialog.appendChild(spacer2);
    dialog.appendChild(cancelButton);

    deleteControls.appendChild(openButton);
    deleteControls.appendChild(dialog);
    return deleteControls;
}

/* creates the join button for the favorites list */
function createJoinButton(roomId) {
    const joinButton = document.createElement('button');
    joinButton.type = 'button';
    joinButton.className = 'p-1.5 text-[12px] bg-skye-gray-dark text-white cursor-pointer hover:bg-skye-gray-hover';
    joinButton.textContent = 'Join';
    joinButton.addEventListener('click', () => {
        joinRoom(roomId);
    });
    return joinButton;
}

/* loads the favorites / own rooms list from the server and populates the UI */
async function loadFavorites() {
    if (!await isAuthenticated()) {
        setErrorMessage('You must be logged in to load favorites.');
        return;
    }

    const sessionId = getStoredValue('session_id');
    if (!sessionId) {
        setErrorMessage('No session ID found. Please log in again.');
        return;
    }

    const response = await fetch('https://auth.skyefactory.com/room', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ operation: 'get-favorites', sessionId })
    });

    if (!response.ok) {
        setErrorMessage('Failed to load favorites. Server error.');
        return;
    }

    const data = await response.json();

    const roomsContainer = document.getElementById('rooms');
    roomsContainer.innerHTML = '';

    if (data.favorites.length === 0 && data.ownRooms.length === 0) {
        const noRoomsMsg = document.createElement('p');
        noRoomsMsg.className = 'text-[12px] text-white';
        noRoomsMsg.textContent = 'No favorite or owned rooms found.';
        roomsContainer.appendChild(noRoomsMsg);
    }

    data.favorites.forEach(favorite => {
        const roomDiv = document.createElement('div');
        roomDiv.className = 'flex items-center justify-between mb-2.5 mt-2.5 bg-skye-gray p-2.5 rounded';

        const roomNameSpan = document.createElement('span');
        roomNameSpan.className = 'text-[14px] text-white';
        roomNameSpan.textContent = favorite.roomName;

        roomDiv.appendChild(roomNameSpan);
        roomDiv.appendChild(createJoinButton(favorite.roomId));
        roomsContainer.appendChild(roomDiv);
    });

    data.ownRooms.forEach(ownRoom => {
        const roomDiv = document.createElement('div');
        roomDiv.className = 'flex items-center justify-between mb-2.5 mt-2.5 bg-skye-gray p-2.5 rounded';

        const roomNameSpan = document.createElement('span');
        roomNameSpan.className = 'text-[14px] text-white';
        roomNameSpan.textContent = ownRoom.roomName;

        roomDiv.appendChild(roomNameSpan);
        roomDiv.appendChild(createJoinButton(ownRoom.roomId));
        roomDiv.appendChild(createDeleteRoomControls(ownRoom, sessionId));
        roomsContainer.appendChild(roomDiv);
    });
}

/* sets up the join room form with the provided roomId and pre-fills the display name if available.
 *      params:
 *          roomId - The ID of the room to join.
 */
function joinRoom(roomId) {
    const nickname = getStoredValue('nickname');
    joinForm.classList.remove("hidden");
    document.getElementById('room-id').value = roomId;
    document.getElementById('display-name').value = nickname || '';
    newRoomForm.classList.add("hidden");
    quickJoin.classList.add("hidden");
    setNewJoinVisibility(false);
}

function joinRoomWithSecret(roomId, roomSecret) {
    const nickname = getStoredValue('nickname');
    joinForm.classList.remove("hidden");
    document.getElementById('room-id').value = roomId;
    document.getElementById('room-secret').value = roomSecret;
    document.getElementById('display-name').value = nickname || '';
    joinForm.requestSubmit();
    newRoomForm.classList.add("hidden");
    quickJoin.classList.add("hidden");
    setNewJoinVisibility(false);
}


/* creates a new room with the specified name after validating the input and checking user authentication.
 *      params:
 *          roomName - The name of the room to be created.
 */
async function createRoom(roomName) {
    if (!await isAuthenticated()) {
        setErrorMessage('You must be logged in to create a room.');
        return;
    }

    const sessionId = getStoredValue('session_id');
    if (!sessionId) {
        setErrorMessage('No session ID found. Please log in again.');
        return;
    }

    if (!roomName || roomName.trim().length === 0) {
        setErrorMessage('Room name cannot be empty.');
        return;
    }

    if (roomName.length > 32) {
        setErrorMessage('Room name cannot exceed 32 characters.');
        return;
    }

    const response = await fetch(createRoomApi, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ operation: 'create', roomName, sessionId })
    });

    if (response.ok) {
        const data = await response.json();
        if (data.success) {
            document.getElementById('room-id-display').textContent = data.roomId;
            const roomSecret = crypto.getRandomValues(new Uint8Array(32));
            const secretString = btoa(String.fromCharCode(...roomSecret))
                .replace(/\+/g, "-")
                .replace(/\//g, "_")
                .replace(/=+$/, "");
            document.getElementById('room-secret-display').textContent = secretString;
            newRoomForm.classList.add("hidden");
            joinForm.classList.add("hidden");
            setNewJoinVisibility(false);
            document.getElementById('room-created-screen').classList.remove("hidden");
            loadFavorites();
            setErrorMessage('');
        } else {
            setErrorMessage(data.message || 'Failed to create room.');
        }
        return;
    }

    if (response.status === 400) {
        const data = await response.json();
        setErrorMessage(data.message || 'Room name already exists.');
        return;
    }

    if (response.status === 500) {
        const data = await response.json();
        setErrorMessage(data.message || 'Room ID collision, please try again.');
        return;
    }

    setErrorMessage('Failed to create room. Server error.');
}

document.getElementById('copy-room-id-btn').addEventListener('click', () => {
    copyText('copy-room-id-btn', 'room-id-display');
});

document.getElementById('copy-room-secret-btn').addEventListener('click', () => {
    copyText('copy-room-secret-btn', 'room-secret-display', 'Copy Room Secret');
});

document.getElementById('back-to-home-btn-new-room').addEventListener('click', goBackToHome);
document.getElementById('back-to-home-btn-join').addEventListener('click', goBackToHome);
document.getElementById('back-to-home-btn-created').addEventListener('click', goBackToHome);

newRoomForm.addEventListener('submit', async (event) => {
    setErrorMessage('');
    event.preventDefault();
    const roomName = document.getElementById('room-name').value.trim();
    await createRoom(roomName);
});

logonForm.addEventListener('submit', async (event) => {
    setErrorMessage('');
    event.preventDefault();
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value.trim();

    if ((!username || !password) || username.length === 0 || password.length === 0) {
        setErrorMessage('Please enter both a username and a password.');
        return;
    }

    try {
        const response = await fetch(logonApi, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, password })
        });
        const data = await response.json();
        if (data.success) {
            setStoredValue('session_id', data.sessionId);
            logonForm.classList.add("hidden");
            newRoomForm.classList.add("hidden");
            setNewJoinVisibility(true);
            joinForm.classList.add("hidden");
            setErrorMessage('');
            loadFavorites();
        } else {
            setErrorMessage(data.message || 'Login failed. Please try again.');
        }
    } catch (error) {
        console.error('Error during login:', error);
        setErrorMessage('An error occurred during login.');
    }
});

document.getElementById('create-room-btn').addEventListener('click', async (event) => {
    setErrorMessage('');
    event.preventDefault();
    if (!await isAuthenticated()) {
        setErrorMessage('You must be logged in to create a room.');
        return;
    }

    newRoomForm.classList.remove("hidden");
    joinForm.classList.add("hidden");
    quickJoin.classList.add("hidden");
    setNewJoinVisibility(false);
});

document.getElementById('join-room-btn').addEventListener('click', async (event) => {
    setErrorMessage('');
    event.preventDefault();
    if (!await isAuthenticated()) {
        setErrorMessage('You must be logged in to join a room.');
        return;
    }

    newRoomForm.classList.add("hidden");
    quickJoin.classList.add("hidden");
    setNewJoinVisibility(false);
    joinForm.classList.remove("hidden");
});

joinForm.addEventListener('submit', async (event) => {
    setErrorMessage('');
    event.preventDefault();
    if (!await isAuthenticated()) {
        setErrorMessage('You must be logged in to join a room.');
        return;
    }

    const displayName = document.getElementById('display-name').value.trim();
    const roomId = document.getElementById('room-id').value.trim();
    if (!displayName || !roomId) {
        setErrorMessage('Please enter both a name and a room ID.');
        return;
    }
    const roomSecret = document.getElementById('room-secret').value.trim();
    if (!roomSecret) {
        if (!warnedUserNoSecret) {
            setErrorMessage('Warning: You are joining without a room secret. This may prevent you from joining the room.');
            warnedUserNoSecret = true;
            return;
        }
        else{
            setStoredValue('nickname', displayName);
            window.location.href = `./room.html?name=${encodeURIComponent(displayName)}&roomId=${encodeURIComponent(roomId)}`;
        }
    } else{
        setStoredValue('nickname', displayName);
        window.location.href = `./room.html?name=${encodeURIComponent(displayName)}&roomId=${encodeURIComponent(roomId)}&secret=${encodeURIComponent(roomSecret)}`;
    }
});

window.addEventListener('DOMContentLoaded', async () => {
    if (await isAuthenticated()) {
        logonForm.classList.add("hidden");
        newRoomForm.classList.add("hidden");
        setNewJoinVisibility(true);
        joinForm.classList.add("hidden");
        loadFavorites();
    } else {
        logonForm.classList.remove("hidden");
        newRoomForm.classList.add("hidden");
        setNewJoinVisibility(false);
        joinForm.classList.add("hidden");
        quickJoin.classList.add("hidden");
    }
});

document.getElementById('skyecord-file-input').addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file) {
        setErrorMessage('No file selected.');
        return;
    }
    if(file.name.endsWith('.skyecord')){
        try {
            const fileContent = await file.text();
            const roomData = JSON.parse(fileContent);
            if (roomData.roomId && roomData.roomSecret) {
                joinRoomWithSecret(roomData.roomId, roomData.roomSecret);
            }
        }   
        catch(e){
            console.error('Error reading or parsing the file:', e);
            setErrorMessage('Failed to read or parse the file. Please ensure it is a valid Skyecord file.');
        }
    } else{
        setErrorMessage('Invalid file type. Please select a .skyecord file.');
    }
});