import {localState} from './roomMisc.js';

var audioCtx = null;
var invertNode = null;
var delayNode = null;


function getAllPeerMicrophoneAudioElements(){
    const audioElements = [];
    for (const peerName in localState.peerConnections) {
        audioElements.push(document.getElementById(`audio-${peerName}`));
    }
    return audioElements;
}

/* starts screen sharing for the local user by capturing the selected window source and sending the video and audio tracks to all connected peers.
 *      params:
 *          windowSource - The source object representing the window to share.
 */
export async function startWindowShare(windowSource){
    try{
        window.electronScreenShare.setTargetSource(windowSource.id);
        const stream = await navigator.mediaDevices.getDisplayMedia({
            audio: true,
            video:{
                width: { ideal: 1280 },
                height: { ideal: 720 },
                frameRate: { ideal: 30 }

            }
        });

        const screenTrack = stream.getVideoTracks()[0];
        const rawAudioTrack = stream.getAudioTracks()[0];
        let audioTrack = rawAudioTrack;
        
        if(rawAudioTrack){
          audioCtx = new (window.AudioContext || window.webkitAudioContext)();
          const screenSource = audioCtx.createMediaStreamSource(new MediaStream([rawScreenAudioTrack]));
          const audioDestination = audioCtx.createMediaStreamDestination();
          invertNode = audioCtx.createGain();
          invertNode.gain.value = -1.0;
          delayNode = audioCtx.createDelay(1.0);
          delayNode.delayTime.value = 0.030;

          delayNode.connect(invertNode);
          invertNode.connect(audioDestination);
          screenSource.connect(audioDestination);

          // 3. Connect all active peer audio elements to the delay node
          const microphoneAudioElements = getAllPeerMicrophoneAudioElements();
          let hasPeerAudio = false;

          microphoneAudioElements.forEach(audioElement => {
              if (audioElement.srcObject && audioElement.srcObject.getAudioTracks().length > 0) {
                  const peerSource = audioCtx.createMediaStreamSource(audioElement.srcObject);
                  peerSource.connect(delayNode);
                  hasPeerAudio = true;
              }
          });

          audioTrack = audioDestination.stream.getAudioTracks()[0];
          localState.screenAudioContext = audioCtx; 
        }

        const outputStream = new MediaStream();
        if (screenTrack) outputStream.addTrack(screenTrack);
        if (audioTrack) outputStream.addTrack(audioTrack);

        localState.localScreenAudioStream = outputStream;
        localState.localScreenVideoStream = outputStream;

        for (const peerName in localState.peerConnections) {
            if(audioTrack){
                const screenAudioSender = localState.peerConnections[peerName].pc.addTrack(audioTrack);
                localState.peerConnections[peerName].screenAudioSender = screenAudioSender;
                localState.socket.send(JSON.stringify({type: 'track-info' , track: audioTrack, stream: stream, roomId: localState.roomId, trackId: audioTrack.id, trackType: `screenShareAudio`, target: peerName}));
            }
            if(screenTrack){
                const screenVideoSender = localState.peerConnections[peerName].pc.addTrack(screenTrack);
                localState.peerConnections[peerName].screenVideoSender = screenVideoSender;
                localState.socket.send(JSON.stringify({type: 'track-info' , track: screenTrack, stream: stream, roomId: localState.roomId, trackId: screenTrack.id, trackType: `screenShareVideo`, target: peerName}));
            }
            localState.peerConnections[peerName].sendStatusUpdate({muted: localState.isMuted, deafened: localState.isDeafened, screenSharing: localState.isScreenSharing});
            
        }
    }
    catch(err){
        console.error('Error accessing display media.', err);
    }
}

/* stops screen sharing for the local user by removing the video and audio tracks from all connected peers and clearing the local screen streams.
 */
export function stopWindowShare(){
    for (const peerName in localState.peerConnections) {
        localState.socket.send(JSON.stringify({type: 'remove-track', roomId: localState.roomId, target: peerName, trackType: 'screenShareVideo', trackId: localState.peerConnections[peerName].screenVideoSender?.track?.id}));
        localState.socket.send(JSON.stringify({type: 'remove-track', roomId: localState.roomId, target: peerName, trackType: 'screenShareAudio', trackId: localState.peerConnections[peerName].screenAudioSender?.track?.id}));
    }
    if(localState.localScreenVideoStream){
        localState.localScreenVideoStream = null;
    }
    if(localState.localScreenAudioStream){
        localState.localScreenAudioStream = null;
    }
}

/* opens the screenshare picker modal to allow the user to pick which window source to share. Returns a Promise that resolves with the selected source or rejects if the user cancels.
 */
export function selectWindowSourceUI() {
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

    const cleanUpAndClose = () => {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
      reject(new Error('User cancelled screen share picker.'));
    };

    closeBtn.onclick = cleanUpAndClose;
    modal.onclick = (e) => { if(e.target === modal) cleanUpAndClose(); };
  });
}

/* displays the screen share modal for a peer, showing their video and audio streams. Allows the user to close the modal.
 *      params:
 *          peerName - The name of the peer sharing their screen.
 *          videoStream - The MediaStream containing the peer's screen video.
 *          audioStream - The MediaStream containing the peer's screen audio.
 */
export function displayPeerScreenShare(peerName, videoStream, audioStream) {
  const modal = document.getElementById('screen-share-display-modal');
  const videoElement = document.getElementById('screen-share-video');
  const audioElement = document.getElementById('screen-share-audio');
  const peerNameElement = document.getElementById('screen-share-peer-name');
  const closeBtn = document.getElementById('close-screen-share-btn');

  peerNameElement.textContent = peerName;
  
  if (videoStream) {
    videoElement.srcObject = videoStream;
  }
  
  if (audioStream) {
    audioElement.srcObject = audioStream;
  }
  console.log(`Displaying screen share from ${peerName}`);
  console.log('Video Stream:', videoStream);
  console.log('Audio Stream:', audioStream);
  console.log('remoteStreams:', localState.peerConnections[peerName].remoteStreams);
  modal.classList.remove('hidden');
  modal.classList.add('flex');

  const closeScreenShare = () => {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    videoElement.srcObject = null;
    audioElement.srcObject = null;
  };

  closeBtn.onclick = closeScreenShare;
  modal.onclick = (e) => { if(e.target === modal) closeScreenShare(); };
}

/**
 * Close the screen share display modal
 */
export function closeScreenShareDisplay() {
  const modal = document.getElementById('screen-share-display-modal');
  const videoElement = document.getElementById('screen-share-video');
  const audioElement = document.getElementById('screen-share-audio');

  modal.classList.add('hidden');
  modal.classList.remove('flex');
  videoElement.srcObject = null;
  audioElement.srcObject = null;
}

