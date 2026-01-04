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
      url: chrome.runtime.getURL('welcome/welcome.html')
    });
  }
});

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('📨 Background received message:', message);

  // Handle different message types
  if (message.action === 'requestTabCapture') {
    // Request tab capture for the sender's tab
    console.log('🎙️ Requesting tab capture for tab:', sender.tab?.id);

    // Handle case where sender.tab might not exist (e.g., from popup)
    if (!sender.tab) {
      console.error('❌ No tab information in sender');
      sendResponse({ error: 'No tab information available' });
      return true;
    }

    chrome.tabCapture.getMediaStreamId({
      targetTabId: sender.tab.id
    }, (streamId) => {
      if (chrome.runtime.lastError) {
        const errorMsg = chrome.runtime.lastError.message || JSON.stringify(chrome.runtime.lastError);
        console.error('❌ Tab capture error:', errorMsg);
        console.error('Full error object:', chrome.runtime.lastError);
        sendResponse({ error: errorMsg });
      } else if (!streamId) {
        console.error('❌ No stream ID returned');
        sendResponse({ error: 'No stream ID returned from tabCapture' });
      } else {
        console.log('✅ Tab capture stream ID obtained:', streamId);
        sendResponse({ streamId: streamId });
      }
    });

    return true; // CRITICAL: Keep message channel open for async response
  }

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
