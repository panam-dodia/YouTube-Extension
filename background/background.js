// Background service worker
console.log('🌉 TalkBridge background service worker started');

// Usage tracking
let captureStartTime = null;
let usageIntervalId = null;
const USAGE_UPDATE_INTERVAL = 1000; // Update every second

// Helper function to get today's date string
function getTodayDateString() {
  return new Date().toISOString().split('T')[0];
}

// Helper function to get current usage for today
async function getTodayUsage() {
  const today = getTodayDateString();
  const data = await chrome.storage.local.get({ dailyUsage: {} });
  return data.dailyUsage[today] || 0;
}

// Helper function to update usage
async function updateUsage(seconds) {
  const today = getTodayDateString();
  const data = await chrome.storage.local.get({ dailyUsage: {} });
  const dailyUsage = data.dailyUsage || {};
  dailyUsage[today] = (dailyUsage[today] || 0) + seconds;
  await chrome.storage.local.set({ dailyUsage });
  console.log(`⏱️ Usage updated: ${dailyUsage[today]}s used today`);
  return dailyUsage[today];
}

// Start tracking usage
function startUsageTracking() {
  if (usageIntervalId) {
    console.warn('⚠️ Usage tracking already running');
    return;
  }

  captureStartTime = Date.now();
  console.log('⏱️ Started usage tracking');

  // Update usage every second
  usageIntervalId = setInterval(async () => {
    await updateUsage(1);
  }, USAGE_UPDATE_INTERVAL);
}

// Stop tracking usage
async function stopUsageTracking() {
  if (usageIntervalId) {
    clearInterval(usageIntervalId);
    usageIntervalId = null;
  }

  if (captureStartTime) {
    // Calculate final session duration
    const sessionDuration = Math.floor((Date.now() - captureStartTime) / 1000);
    console.log(`⏱️ Stopped usage tracking. Session duration: ${sessionDuration}s`);
    captureStartTime = null;
  }
}

// Check if user has exceeded daily limit
async function checkDailyLimit() {
  const DAILY_LIMIT_SECONDS = 15 * 60; // 15 minutes in seconds
  const todayUsage = await getTodayUsage();
  return todayUsage >= DAILY_LIMIT_SECONDS;
}

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
        // Check daily limit before starting
        const limitExceeded = await checkDailyLimit();
        if (limitExceeded) {
          const todayUsage = await getTodayUsage();
          const minutesUsed = Math.floor(todayUsage / 60);
          console.warn(`⚠️ Daily limit exceeded: ${minutesUsed} minutes used`);
          sendResponse({
            error: 'Daily limit exceeded',
            message: `You've used your daily limit of 15 minutes. Try again tomorrow!`,
            minutesUsed
          });
          return;
        }

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

              // Start usage tracking
              startUsageTracking();

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
        // Check daily limit before starting
        const limitExceeded = await checkDailyLimit();
        if (limitExceeded) {
          const todayUsage = await getTodayUsage();
          const minutesUsed = Math.floor(todayUsage / 60);
          console.warn(`⚠️ Daily limit exceeded: ${minutesUsed} minutes used`);
          sendResponse({
            error: 'Daily limit exceeded',
            message: `You've used your daily limit of 15 minutes. Try again tomorrow!`,
            minutesUsed
          });
          return;
        }

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

            // Start usage tracking
            startUsageTracking();

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

  // Handle simple popup open request (for trial expired state)
  if (message.action === 'openPopup') {
    console.log('📱 Opening popup...');

    chrome.action.openPopup()
      .then(() => {
        console.log('✅ Popup opened successfully');
        sendResponse({ success: true });
      })
      .catch((error) => {
        console.error('❌ Failed to open popup:', error);
        sendResponse({ error: error.message });
      });

    return true;
  }

  // Handle stop tab capture request
  if (message.action === 'stopTabCapture') {
    console.log('🛑 Stopping tab capture...');

    // Stop usage tracking
    (async () => {
      await stopUsageTracking();

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
          const tabId = message.tabId || sender.tab?.id;
          if (tabId) {
            chrome.tabs.sendMessage(tabId, {
              action: 'tabCaptureStopped'
            });
          }

          sendResponse({ success: true });
        }
      });
    })();

    return true; // Keep message channel open for async response
  }

  // Handle transcript relay from offscreen document to content script
  if (message.action === 'relayTranscript') {
    console.log('📨 Relaying transcript from offscreen to content script');

    // Find the tab that initiated the capture
    // We'll send to all tabs for now, content script will filter
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length > 0) {
        chrome.tabs.sendMessage(tabs[0].id, {
          action: 'transcriptReceived',
          transcript: message.transcript
        }, (response) => {
          if (chrome.runtime.lastError) {
            console.error('❌ Failed to send transcript to content script:', chrome.runtime.lastError.message);
          } else {
            console.log('✅ Transcript delivered to content script');
          }
        });
      }
    });

    sendResponse({ success: true });
    return true;
  }

  // Handle audio playback request from content script to offscreen document
  if (message.action === 'playTranslatedAudio') {
    console.log('📨 Forwarding audio to offscreen document for playback');

    // Forward to offscreen document
    chrome.runtime.sendMessage({
      action: 'playTranslatedAudio',
      audioData: message.audioData,
      text: message.text
    }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('❌ Failed to send audio to offscreen:', chrome.runtime.lastError.message);
      } else {
        console.log('✅ Audio forwarded to offscreen');
      }
    });

    sendResponse({ success: true });
    return true;
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

    // Check daily limit before starting
    (async () => {
      const limitExceeded = await checkDailyLimit();
      if (limitExceeded) {
        const todayUsage = await getTodayUsage();
        const minutesUsed = Math.floor(todayUsage / 60);
        console.warn(`⚠️ Daily limit exceeded: ${minutesUsed} minutes used`);
        chrome.tabs.sendMessage(tabId, {
          action: 'dailyLimitExceeded',
          message: `You've used your daily limit of 15 minutes. Try again tomorrow!`,
          minutesUsed
        });
        sendResponse({ error: 'Daily limit exceeded' });
        return;
      }
    })();

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

              // Start usage tracking
              startUsageTracking();

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

  // Handle tab capture not working notification
  if (message.action === 'notifyTabCaptureNotWorking') {
    console.warn('⚠️ Tab audio capture not working:', message.message);

    // Notify the content script to show user a message
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length > 0) {
        chrome.tabs.sendMessage(tabs[0].id, {
          action: 'showTabCaptureError',
          message: message.message
        });
      }
    });

    sendResponse({ success: true });
    return true;
  }

  // Handle start usage tracking request (for transcript-based translation)
  if (message.action === 'startUsageTracking') {
    startUsageTracking();
    sendResponse({ success: true });
    return true;
  }

  // Handle stop usage tracking request
  if (message.action === 'stopUsageTracking') {
    stopUsageTracking();
    sendResponse({ success: true });
    return true;
  }

  // Handle get usage request (for popup to display current usage)
  if (message.action === 'getUsage') {
    (async () => {
      const todayUsage = await getTodayUsage();
      const minutesUsed = Math.floor(todayUsage / 60);
      const secondsUsed = todayUsage % 60;
      const isCapturing = captureStartTime !== null;

      sendResponse({
        success: true,
        totalSeconds: todayUsage,
        minutes: minutesUsed,
        seconds: secondsUsed,
        isCapturing
      });
    })();
    return true;
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
