// Background service worker
console.log('🌉 TalkBridge background service worker started');

// Listen for extension installation
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('TalkBridge extension installed!');

    // Set default settings
    chrome.storage.sync.set({
      targetLanguage: 'English',
      enableTranslation: false,
      enableQA: false,
      enableDubbing: false
    });

    // Open welcome page
    chrome.tabs.create({
      url: 'https://talkbridge-frontend-149462569558.us-central1.run.app'
    });
  }
});

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Message received:', message);

  // Handle different message types
  switch (message.type) {
    case 'FETCH_TRANSCRIPT':
      // Future: Handle transcript fetching in background if needed
      break;

    case 'LOG':
      console.log('[Content Script]:', message.data);
      break;

    default:
      console.log('Unknown message type:', message.type);
  }

  return true; // Keep message channel open for async responses
});
