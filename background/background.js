// Background service worker
console.log('🌉 TalkBridge background service worker started');

// Offscreen document setup
async function setupOffscreenDocument() {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL('offscreen/offscreen.html')]
  });

  if (existingContexts.length > 0) {
    console.log('✅ Offscreen document already exists');
    return;
  }

  console.log('📄 Creating offscreen document...');
  await chrome.offscreen.createDocument({
    url: 'offscreen/offscreen.html',
    reasons: ['USER_MEDIA'],
    justification: 'Tab audio capture for real-time translation'
  });
  console.log('✅ Offscreen document created');
}

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

// Listen for messages from content scripts and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('📨 Background received message:', message);

  // Handle direct tab capture from floating button (better UX)
  if (message.action === 'startDirectTabCapture') {
    console.log('🎬 Starting direct tab capture from floating button');
    console.log('   Sender tab ID:', sender.tab?.id);

    if (!sender.tab || !sender.tab.id) {
      console.error('❌ No tab information in sender');
      sendResponse({ error: 'No tab information available' });
      return true;
    }

    const tabId = sender.tab.id;
    const sourceLanguage = message.sourceLanguage || 'en';

    // Use chrome.tabCapture.getMediaStreamId() - works in background without user gesture
    (async () => {
      try {
        await setupOffscreenDocument();

        console.log('🎤 Calling chrome.tabCapture.getMediaStreamId()...');
        chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (streamId) => {
          if (chrome.runtime.lastError) {
            const errorMsg = chrome.runtime.lastError.message || JSON.stringify(chrome.runtime.lastError);
            console.error('❌ Tab capture error:', errorMsg);
            sendResponse({ error: errorMsg });
            return;
          }

          if (!streamId) {
            console.error('❌ No streamId returned');
            sendResponse({ error: 'No streamId returned from tabCapture' });
            return;
          }

          console.log('✅ Tab capture streamId obtained:', streamId);

          // Send streamId to offscreen document to start capture immediately
          chrome.runtime.sendMessage({
            action: 'startCapture',
            stream: streamId,
            sourceLanguage: sourceLanguage
          }, (offscreenResponse) => {
            if (chrome.runtime.lastError) {
              console.error('❌ Failed to start capture in offscreen:', chrome.runtime.lastError.message);
              sendResponse({ error: chrome.runtime.lastError.message });
            } else {
              console.log('✅ Offscreen document started capture');

              // Notify content script that capture has started
              chrome.tabs.sendMessage(tabId, {
                action: 'tabCaptureStarted'
              });

              sendResponse({ success: true });
            }
          });
        });
      } catch (error) {
        console.error('❌ Failed to setup offscreen document:', error);
        sendResponse({ error: error.message });
      }
    })();

    return true; // Keep message channel open for async response
  }

  // Handle tab capture start from popup (legacy - kept for backward compatibility)
  if (message.action === 'startTabCapture') {
    console.log('🎬 Starting tab capture with streamId:', message.streamId);
    console.log('   Target tab ID:', message.tabId);

    if (!message.streamId) {
      console.error('❌ No streamId provided');
      sendResponse({ error: 'No streamId provided' });
      return true;
    }

    if (!message.tabId) {
      console.error('❌ No tabId provided');
      sendResponse({ error: 'No tabId provided' });
      return true;
    }

    // Create offscreen document if it doesn't exist
    (async () => {
      try {
        await setupOffscreenDocument();

        // Send streamId to offscreen document to start capture
        chrome.runtime.sendMessage({
          action: 'startCapture',
          stream: message.streamId,
          sourceLanguage: message.sourceLanguage || 'en'
        }, (response) => {
          if (chrome.runtime.lastError) {
            console.error('❌ Failed to start capture in offscreen:', chrome.runtime.lastError.message);
            sendResponse({ error: chrome.runtime.lastError.message });
          } else {
            console.log('✅ Offscreen document started capture');

            // Notify content script that capture has started
            chrome.tabs.sendMessage(message.tabId, {
              action: 'tabCaptureStarted'
            });

            sendResponse({ success: true });
          }
        });
      } catch (error) {
        console.error('❌ Failed to setup offscreen document:', error);
        sendResponse({ error: error.message });
      }
    })();

    return true; // Keep message channel open for async response
  }

  // Handle legacy requestTabCapture (kept for backward compatibility)
  if (message.action === 'requestTabCapture') {
    // Request tab capture for the sender's tab
    console.log('🎙️ Requesting tab capture for tab:', sender.tab?.id);

    // Handle case where sender.tab might not exist (e.g., from popup)
    if (!sender.tab) {
      console.error('❌ No tab information in sender');
      sendResponse({ error: 'No tab information available' });
      return true;
    }

    // Use chrome.tabCapture.capture() directly with tabs permission
    chrome.tabCapture.capture({
      audio: true,
      video: false
    }, (stream) => {
      if (chrome.runtime.lastError) {
        const errorMsg = chrome.runtime.lastError.message || JSON.stringify(chrome.runtime.lastError);
        console.error('❌ Tab capture error:', errorMsg);
        console.error('Full error object:', chrome.runtime.lastError);
        sendResponse({ error: errorMsg });
      } else if (!stream) {
        console.error('❌ No stream returned');
        sendResponse({ error: 'No stream returned from tabCapture' });
      } else {
        console.log('✅ Tab capture stream obtained');
        // We can't send the stream directly via sendResponse
        // Instead, we'll send success and let content script use offscreen document
        sendResponse({ success: true, message: 'Use offscreen document for capture' });
      }
    });

    return true; // CRITICAL: Keep message channel open for async response
  }

  // Handle popup open request for auto-capture
  if (message.action === 'openPopupForCapture') {
    console.log('🎬 Opening popup for automatic tab capture...');

    chrome.action.openPopup()
      .then(() => {
        console.log('✅ Popup opened successfully');
        sendResponse({ success: true });
      })
      .catch((error) => {
        console.error('❌ Failed to open popup:', error);
        sendResponse({ error: error.message });
      });

    return true; // Keep message channel open for async response
  }

  // Handle stop tab capture request
  if (message.action === 'stopTabCapture') {
    console.log('🛑 Stopping tab capture...');

    // Send stop message to offscreen document
    chrome.runtime.sendMessage({
      action: 'stopCapture'
    }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('❌ Failed to stop capture in offscreen:', chrome.runtime.lastError.message);
        sendResponse({ error: chrome.runtime.lastError.message });
      } else {
        console.log('✅ Tab capture stopped successfully');

        // Notify content script
        if (message.tabId) {
          chrome.tabs.sendMessage(message.tabId, {
            action: 'tabCaptureStopped'
          });
        }

        sendResponse({ success: true });
      }
    });

    return true; // Keep message channel open for async response
  }

  // Handle desktop capture request (fallback for Netflix and videos without transcripts)
  if (message.action === 'startDesktopCapture') {
    console.log('🖥️ Starting desktop capture (system audio)...');

    const tabId = sender.tab?.id || message.tabId;
    const sourceLanguage = message.sourceLanguage || 'en';

    if (!tabId) {
      console.error('❌ No tab information available');
      sendResponse({ error: 'No tab information available' });
      return false;
    }

    // Request desktop/window capture with system audio
    chrome.desktopCapture.chooseDesktopMedia(
      ['screen', 'window', 'audio'],
      sender.tab,
      async (streamId) => {
        if (!streamId) {
          console.error('❌ User cancelled desktop capture or no streamId returned');
          chrome.tabs.sendMessage(tabId, {
            action: 'desktopCaptureError',
            error: 'Desktop capture cancelled by user'
          });
          return;
        }

        console.log('✅ Desktop capture streamId obtained:', streamId);

        try {
          await setupOffscreenDocument();

          // Send streamId to offscreen document to start capture
          chrome.runtime.sendMessage({
            action: 'startCapture',
            stream: streamId,
            sourceLanguage: sourceLanguage,
            captureType: 'desktop'
          }, () => {
            if (chrome.runtime.lastError) {
              console.error('❌ Failed to start desktop capture in offscreen:', chrome.runtime.lastError.message);
              chrome.tabs.sendMessage(tabId, {
                action: 'desktopCaptureError',
                error: chrome.runtime.lastError.message
              });
            } else {
              console.log('✅ Desktop capture started in offscreen document');

              // Notify content script
              chrome.tabs.sendMessage(tabId, {
                action: 'tabCaptureStarted',
                captureType: 'desktop'
              });
            }
          });
        } catch (error) {
          console.error('❌ Failed to setup offscreen document:', error);
          chrome.tabs.sendMessage(tabId, {
            action: 'desktopCaptureError',
            error: error.message
          });
        }
      }
    );

    // Send immediate response to prevent message channel timeout
    sendResponse({ success: true, message: 'Desktop capture request initiated' });
    return false;
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
