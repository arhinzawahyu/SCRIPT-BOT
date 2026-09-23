// Runtime state shared across modules (avoids import cycles).
const state = {
  useCode: true,
  loggedInNumber: null,
  currentSock: null,
  lastActiveTime: Date.now(),
  welcomeMessage: false,
  isConnecting: false,
};

module.exports = { state };