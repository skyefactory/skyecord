import {localState} from './roomMisc.js';
import {screenShareButton} from './roomUi.js';
async function startWindowShare(windowSource){
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

        for (const peerName in localState.peerConnections) {
            if(audioTrack){
                localState.peerConnections[peerName].pc.addTrack(audioTrack);
                localState.socket.send(JSON.stringify({type: 'track-info' , track: audioTrack, stream: stream, roomId: localState.roomId, trackId: audioTrack.id, trackType: `screenShareAudio`, target: peerName}));
            }
            if(screenTrack){
                localState.peerConnections[peerName].pc.addTrack(screenTrack);
                localState.socket.send(JSON.stringify({type: 'track-info' , track: screenTrack, stream: stream, roomId: localState.roomId, trackId: screenTrack.id, trackType: `screenShareVideo`, target: peerName}));
            }
        }
    }
    catch(err){
        console.error('Error accessing display media.', err);
    }
}


function selectWindowSourceUI() {
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

screenShareButton.addEventListener('click', async () => {
    try {
        const chosenSource = await selectWindowSourceUI();
        
        await startWindowShare(chosenSource);
    } catch (err) {
        console.log(err.message);
    }
});