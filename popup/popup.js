// Popup script - handles settings UI
document.addEventListener('DOMContentLoaded', async () => {
  const statusIndicator = document.getElementById('status-indicator');
  const statusText = document.getElementById('status-text');
  const targetLanguage = document.getElementById('target-language');
  const enableTranslation = document.getElementById('enable-translation');
  const enableQA = document.getElementById('enable-qa');
  const enableDubbing = document.getElementById('enable-dubbing');
  const saveButton = document.getElementById('save-settings');
  const startTranslationButton = document.getElementById('start-translation');

  // Load saved settings
  const settings = await chrome.storage.sync.get({
    targetLanguage: 'English',
    enableTranslation: false,
    enableQA: false,
    enableDubbing: false
  });

  targetLanguage.value = settings.targetLanguage;
  enableTranslation.checked = settings.enableTranslation;
  enableQA.checked = settings.enableQA;
  enableDubbing.checked = settings.enableDubbing;

  // Check if current tab is YouTube
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab.url && tab.url.includes('youtube.com/watch')) {
    statusIndicator.classList.remove('inactive');
    statusIndicator.classList.add('active');
    statusText.textContent = 'Active on YouTube';
  }

  // Start Translation - handles tab audio capture with user gesture
  startTranslationButton.addEventListener('click', async () => {
    try {
      console.log('🎬 Start Translation button clicked');

      // Get the current tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!tab || !tab.id) {
        throw new Error('No active tab found');
      }

      // Visual feedback - starting
      startTranslationButton.textContent = 'Starting...';
      startTranslationButton.disabled = true;

      // Request tab capture stream ID (user gesture is preserved here in popup context)
      chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id }, async (streamId) => {
        if (chrome.runtime.lastError) {
          console.error('❌ Failed to get stream ID:', chrome.runtime.lastError.message);
          startTranslationButton.textContent = 'Start Translation';
          startTranslationButton.disabled = false;
          alert('Failed to start translation: ' + chrome.runtime.lastError.message);
          return;
        }

        console.log('✅ Got stream ID:', streamId);

        // Send streamId to background script to relay to content script
        chrome.runtime.sendMessage({
          action: 'startTabCapture',
          streamId: streamId,
          tabId: tab.id
        }, (response) => {
          if (chrome.runtime.lastError) {
            console.error('❌ Failed to send message:', chrome.runtime.lastError.message);
            startTranslationButton.textContent = 'Start Translation';
            startTranslationButton.disabled = false;
            return;
          }

          if (response && response.success) {
            console.log('✅ Translation started successfully');
            startTranslationButton.textContent = 'Translation Active';
            startTranslationButton.style.background = '#4caf50';
          } else {
            console.error('❌ Failed to start translation:', response?.error);
            startTranslationButton.textContent = 'Start Translation';
            startTranslationButton.disabled = false;
            alert('Failed to start translation: ' + (response?.error || 'Unknown error'));
          }
        });
      });
    } catch (error) {
      console.error('❌ Error starting translation:', error);
      startTranslationButton.textContent = 'Start Translation';
      startTranslationButton.disabled = false;
      alert('Error: ' + error.message);
    }
  });

  // Save settings
  saveButton.addEventListener('click', async () => {
    const newSettings = {
      targetLanguage: targetLanguage.value,
      enableTranslation: enableTranslation.checked,
      enableQA: enableQA.checked,
      enableDubbing: enableDubbing.checked
    };

    await chrome.storage.sync.set(newSettings);

    // Send message to content script to update
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, {
          type: 'UPDATE_SETTINGS',
          settings: newSettings
        });
      }
    });

    // Visual feedback
    saveButton.textContent = 'Saved!';
    saveButton.style.background = '#4caf50';
    setTimeout(() => {
      saveButton.textContent = 'Save Settings';
      saveButton.style.background = '';
    }, 1500);
  });
});
