if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true) {
    console.log('Running in standalone mode');
    window.resizeTo(400, 600);
    window.addEventListener('resize', () => {
        console.log('Window resized to:', window.innerWidth, 'x', window.innerHeight);
        window.resizeTo(400, 600);
    });

    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', () => {
            const isMaximized = window.visualViewport.width === screen.availWidth;
            if (isMaximized) {
                console.log('PWA caught maximization via Visual Viewport.');
                window.resizeTo(400, 600);
            }
        });
    }
}

const logonForm = document.getElementById('login-form');
const newRoomForm = document.getElementById('new-room-form');
const newJoinForm = document.getElementById('new-join-form');
const quickJoin = document.getElementById('quick-join');
const joinForm = document.getElementById('join-form');
const errorMsg = document.getElementById('error-msg');
let errorMsgTimeoutId = null;

const logonApi = 'https://auth.skyefactory.com/login';
const verifySessionApi = 'https://auth.skyefactory.com/verify-session';
const createRoomApi = 'https://auth.skyefactory.com/room';

function copyText(buttonId, textId) {
    const textElement = document.getElementById(textId);
    const textToCopy = textElement.textContent;

    navigator.clipboard.writeText(textToCopy).then(() => {
        const button = document.getElementById(buttonId);
        button.textContent = 'Copied!';
        setTimeout(() => {
            button.textContent = 'Copy Room ID';
        }, 2000);
    }).catch(err => {
        console.error('Failed to copy text: ', err);
    });
}

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

function getStoredValue(key) {
    return localStorage.getItem(key) ?? '';
}

function setStoredValue(key, value) {
    localStorage.setItem(key, value);
}

async function isAuthenticated() {
    const sessionId = getStoredValue('session_id');
    if (!sessionId) {
        console.log('No session ID found in cookies.');
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

function setNewJoinVisibility(isVisible) {
    if(isVisible){
        newJoinForm.classList.remove("hidden");
        quickJoin.classList.remove("hidden");
    } else{
        newJoinForm.classList.add("hidden");
        quickJoin.classList.add("hidden");
    }
}

function goBackToHome() {
    newRoomForm.classList.add("hidden");
    joinForm.classList.add("hidden");
    document.getElementById('room-created-screen').classList.add("hidden");
    setNewJoinVisibility(true);
}

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
    dialog.className = 'bg-skye-gray-dark text-white ml-5';

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
    console.log('Favorites:', data);

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

function joinRoom(roomId) {
    const nickname = getStoredValue('nickname');
    if (!nickname) {
        joinForm.classList.remove("hidden");
        document.getElementById('room-id').value = roomId;
        newRoomForm.classList.add("hidden");
        quickJoin.classList.add("hidden");
        setNewJoinVisibility(false);
        return;
    }

    window.location.href = `./room.html?name=${encodeURIComponent(nickname)}&roomId=${encodeURIComponent(roomId)}`;
}

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
    console.log('Create room response:', response);

    if (response.ok) {
        const data = await response.json();
        if (data.success) {
            document.getElementById('room-id-display').textContent = data.roomId;
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

document.getElementById('back-to-home-btn-new-room').addEventListener('click', goBackToHome);
document.getElementById('back-to-home-btn-join').addEventListener('click', goBackToHome);
document.getElementById('back-to-home-btn-created').addEventListener('click', goBackToHome);

newRoomForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const roomName = document.getElementById('room-name').value.trim();
    await createRoom(roomName);
});

logonForm.addEventListener('submit', async (event) => {
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
            quickJoin.classList.add("hidden");
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

    setStoredValue('nickname', displayName);
    window.location.href = `./room.html?name=${encodeURIComponent(displayName)}&roomId=${encodeURIComponent(roomId)}`;
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
