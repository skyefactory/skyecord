import {localState} from './roomMisc.js';
export async function startWindowShare(windowSource){
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

        localState.localScreenAudioStream = audioTrack;
        localState.localScreenVideoStream = screenTrack;

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

/**
 * Display a peer's screen share in the display modal
 * @param {string} peerName - Name of the peer sharing their screen
 * @param {MediaStream} videoStream - MediaStream containing the screen share video
 * @param {MediaStream} audioStream - MediaStream containing the screen share audio
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

