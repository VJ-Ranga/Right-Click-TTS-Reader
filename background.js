// State variables
let utteranceQueue = [];
let currentUtteranceIndex = 0;
let isSpeaking = false;
let isPaused = false;

// Initialize extension
function initializeExtension() {
  // Reset state
  utteranceQueue = [];
  currentUtteranceIndex = 0;
  isSpeaking = false;
  isPaused = false;

  // Create context menu
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "readSelectedText",
      title: "🔊 Read Selected Text",
      contexts: ["selection"]
    });
  });
}

// Handle extension installation and startup
chrome.runtime.onInstalled.addListener(initializeExtension);
chrome.runtime.onStartup.addListener(initializeExtension);

// Handle context menu click
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "readSelectedText" && info.selectionText) {
    chrome.storage.local.set({ selectedText: info.selectionText.trim() }, () => {
      chrome.action.openPopup();
    });
  }
});

// Split text into sentences with better handling of abbreviations
function splitText(text) {
  if (!text) return [];
  
  // Handle common abbreviations that shouldn't split sentences
  const abbreviations = ['Mr.', 'Mrs.', 'Dr.', 'Prof.', 'etc.', 'e.g.', 'i.e.'];
  const tempText = abbreviations.reduce((acc, abbr) => 
    acc.replace(new RegExp(`\\b${abbr}\\b`, 'g'), abbr.replace('.', '{abbr-dot}')), text);
  
  // Split sentences
  const sentences = tempText.match(/[^.!?]+[.!?]+[\])'"`'"]*|.+/g) || [text];
  
  // Restore abbreviations and trim whitespace
  return sentences.map(s => s.replace(/{abbr-dot}/g, '.').trim()).filter(s => s.length > 0);
}

// Update state and notify popup
function updateState(changes) {
  // Update local variables
  if (changes.isSpeaking !== undefined) isSpeaking = changes.isSpeaking;
  if (changes.isPaused !== undefined) isPaused = changes.isPaused;
  if (changes.currentUtteranceIndex !== undefined) {
    currentUtteranceIndex = Math.max(0, Math.min(changes.currentUtteranceIndex, utteranceQueue.length - 1));
  }
  
  // Calculate progress
  const progress = utteranceQueue.length > 0 
    ? (currentUtteranceIndex / utteranceQueue.length) * 100 
    : 0;
  
  // Send state to any open popup
  chrome.runtime.sendMessage({
    action: 'stateUpdate',
    state: {
      isSpeaking,
      isPaused,
      currentUtteranceIndex,
      totalChunks: utteranceQueue.length,
      progress: changes.progress !== undefined ? changes.progress : progress,
      status: changes.status || ''
    }
  }).catch(() => {
    // Ignore errors when no popup is listening
  });
}

// Handle messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  try {
    switch(message.action) {
      case 'start':
        if (!isSpeaking) {
          utteranceQueue = splitText(message.text);
          currentUtteranceIndex = 0;
          
          updateState({ 
            isSpeaking: true, 
            isPaused: false, 
            status: "Reading",
            currentUtteranceIndex: 0,
            progress: 0
          });
          
          chrome.runtime.sendMessage({ 
            action: 'performSpeech',
            text: message.text
          }).catch(() => {});
        }
        break;
        
      case 'updateProgress':
        currentUtteranceIndex = message.currentUtteranceIndex || 0;
        updateState({ 
          currentUtteranceIndex, 
          progress: (currentUtteranceIndex / utteranceQueue.length) * 100 
        });
        break;
        
      case 'speechEnded':
        updateState({ isSpeaking: false, isPaused: false, status: "Done" });
        break;
        
      case 'stop':
        updateState({ isSpeaking: false, isPaused: false, status: "Stopped" });
        break;
        
      case 'getState':
        sendResponse({
          isSpeaking,
          isPaused,
          currentUtteranceIndex,
          totalChunks: utteranceQueue.length,
          progress: utteranceQueue.length > 0 
            ? (currentUtteranceIndex / utteranceQueue.length) * 100 
            : 0,
          status: isSpeaking 
            ? "Reading" 
            : "Ready"
        });
        return true;
        
      default:
        console.warn('Unknown message action:', message.action);
    }
  } catch (error) {
    console.error('Error handling message:', error);
    updateState({ status: "Error", isSpeaking: false, isPaused: false });
    sendResponse({ error: error.message });
  }
});