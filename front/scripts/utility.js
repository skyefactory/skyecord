export function setSessionID(sessionID){
    localStorage.setItem("sessionID", sessionID);
}

export function getSessionID(){
    return localStorage.getItem("sessionID");
}