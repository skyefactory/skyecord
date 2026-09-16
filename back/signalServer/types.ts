import { WebSocket } from "ws";
export interface SkyecordWebSocket extends WebSocket {
  isAlive: boolean;
  sessionID?: string;
  peerID?: peerID;
  roomID?: roomID;
}
export type peerID = string;
export type roomID = string;
export interface ClientMessage<T = JoinRoomData | SDPData | ICECandidateData | UpdateUsernameData>{
    type: string;
    data: T;
    to: peerID;
}

export interface ServerMessage<T = UserJoinedData | RoomUsersData | SDPData | ICECandidateData>{
    type: string;
    data: T;
    from: peerID;
}

export interface JoinRoomData{
    username: string;
    roomID: roomID;
}

export interface SDPData{
    description: RTCSessionDescriptionInit;
}

export interface ICECandidateData{
    candidate: RTCIceCandidateInit;
}

export interface UpdateUsernameData{
    newUsername: string;
}

export interface UserJoinedData{
    peerID: peerID;
    username: string;
}

export interface RoomUsersData{
    users: Array<{peerID: peerID, username: string}>;
}