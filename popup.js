// UI elements
const voiceSelect = document.getElementById('voiceSelect');
const rateSlider = document.getElementById('rateSlider');
const rateVal = document.getElementById('rateVal');
const status = document.getElementById('status');
const playBtn = document.getElementById('playBtn');
const stopBtn = document.getElementById('stopBtn');
const progressContainer = document.getElementById('progressContainer');
const currentChunk = document.getElementById('currentChunk');
const totalChunks = document.getElementById('totalChunks');
const readingProgress = document.getElementById('readingProgress');

// State
let selectedText = '';
let isSpeaking = false;
let isPaused = false;
let currentUtteranceIndex = 0;
let utteranceQueue = [];
let currentUtterance = null;
let voices = [];
let voiceLoadRetries = 0;

document.addEventListener('DOMContentLoaded', initializePopup);

async function initializePopup() {
  try {
    const data = await chrome.storage.local.get(['selectedVoice', 'rate', 'selectedText']);
    selectedText = data.selectedText || '';
    rateSlider.value = data.rate || 1.0;
    rateVal.textContent = (data.rate || 1.0).toFixed(1);

    if (!selectedText) {
      status.textContent = "No text selected.";
      playBtn.disabled = true;
    }

    loadVoices();
    setupEventListeners();
    await getCurrentState();
  } catch (error) {
    console.error('Initialization error:', error);
    status.textContent = "❌ Initialization error";
    status.style.backgroundColor = '#f8d7da';
  }
}

function loadVoices() {
  voices = speechSynthesis.getVoices();

  if (voices.length === 0 && voiceLoadRetries < 10) {
    setTimeout(loadVoices, 250);
    voiceLoadRetries++;
    return;
  }

  voiceSelect.innerHTML = '';
  
  // Default UK Male Voice
  let defaultVoiceFound = false;
  let defaultVoiceIndex = 0;
  
  voices.forEach((voice, index) => {
    const option = document.createElement('option');
    option.value = voice.name;
    option.textContent = `${voice.name} (${voice.lang})`;
    voiceSelect.appendChild(option);
    
    // Check for Google UK English Male
    if (voice.name === 'Google UK English Male' && voice.lang === 'en-GB') {
      defaultVoiceFound = true;
      defaultVoiceIndex = index;
    }
  });

  chrome.storage.local.get(['selectedVoice'], (data) => {
    if (data.selectedVoice) {
      voiceSelect.value = data.selectedVoice;
    } else if (defaultVoiceFound) {
      // Set default voice to Google UK English Male
      voiceSelect.selectedIndex = defaultVoiceIndex;
      chrome.storage.local.set({ selectedVoice: voices[defaultVoiceIndex].name });
    }
  });
}

function splitText(text) {
  const maxLength = 600;
  const chunks = [];
  let current = '';
  const sentences = text.match(/[^.!?]+[.!?]+[\])'"`']*|.+/g) || [text];

  for (const sentence of sentences) {
    if ((current + sentence).length <= maxLength) {
      current += sentence;
    } else {
      if (current) chunks.push(current.trim());
      current = sentence;
    }
  }
  if (current) chunks.push(current.trim());

  return chunks;
}

function speakText(text) {
  cleanupUtterances();
  setTimeout(() => {
    utteranceQueue = splitText(text);
    console.log("Chunks:", utteranceQueue.length, utteranceQueue);
    currentUtteranceIndex = 0;
    speakNext();
  }, 100);
}

function speakNext() {
  if (currentUtteranceIndex >= utteranceQueue.length) {
    chrome.runtime.sendMessage({ action: 'speechEnded' });
    return;
  }

  const voiceName = voiceSelect.value;
  const rate = parseFloat(rateSlider.value);
  const chunk = utteranceQueue[currentUtteranceIndex];

  currentUtterance = new SpeechSynthesisUtterance(chunk);
  const voice = voices.find(v => v.name === voiceName);
  if (voice) currentUtterance.voice = voice;

  currentUtterance.rate = rate;
  currentUtterance.volume = 1.0; // Fixed at maximum volume

  currentUtterance.onend = () => {
    currentUtteranceIndex++;
    chrome.runtime.sendMessage({ action: 'updateProgress', currentUtteranceIndex });
    speakNext();
  };

  currentUtterance.onerror = (event) => {
    console.error('Speech synthesis error:', event);
    currentUtteranceIndex++;
    chrome.runtime.sendMessage({ action: 'updateProgress', currentUtteranceIndex });
    speakNext();
  };

  speechSynthesis.speak(currentUtterance);
}

function cleanupUtterances() {
  speechSynthesis.cancel();
  if (currentUtterance) {
    currentUtterance.onend = null;
    currentUtterance.onerror = null;
    currentUtterance = null;
  }
}

async function getCurrentState() {
  try {
    const state = await chrome.runtime.sendMessage({ action: 'getState' });
    updateUIState(state);
  } catch (error) {
    console.error('Error getting state:', error);
  }
}

function setupEventListeners() {
  playBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'start', text: selectedText });
    if (selectedText) speakText(selectedText);
  });

  stopBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'stop' });
    cleanupUtterances();
  });

  voiceSelect.addEventListener('change', () => {
    chrome.storage.local.set({ selectedVoice: voiceSelect.value });
  });

  rateSlider.addEventListener('input', () => {
    const rate = parseFloat(rateSlider.value);
    rateVal.textContent = rate.toFixed(1);
    chrome.storage.local.set({ rate });
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'stateUpdate') {
      updateUIState(message.state);
    } else if (message.action === 'performSpeech' && message.text) {
      if (!isSpeaking) {
        speakText(message.text);
      }
    }
  });
}

function updateUIState(state) {
  if (!state) return;
  isSpeaking = state.isSpeaking;
  isPaused = false; // We're not using pause functionality anymore
  currentUtteranceIndex = state.currentUtteranceIndex || 0;

  playBtn.disabled = isSpeaking;
  stopBtn.disabled = !isSpeaking;

  if (state.status) {
    switch (state.status) {
      case 'Reading':
        status.textContent = "🔊 Reading...";
        status.style.backgroundColor = '#d6f5d6';
        break;
      case 'Stopped':
        status.textContent = "⏹ Stopped";
        status.style.backgroundColor = '#f8d7da';
        break;
      case 'Done':
        status.textContent = "✅ Done";
        status.style.backgroundColor = '#d6f5d6';
        break;
      case 'Error':
        status.textContent = "❌ Error";
        status.style.backgroundColor = '#f8d7da';
        break;
      default:
        status.textContent = state.status;
        status.style.backgroundColor = '#ecf0f1';
    }
  }

  if (state.totalChunks > 0) {
    progressContainer.style.display = 'block';
    currentChunk.textContent = currentUtteranceIndex + 1;
    totalChunks.textContent = state.totalChunks;
    readingProgress.value = state.progress;
  } else {
    progressContainer.style.display = 'none';
  }
}