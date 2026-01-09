// Popup script - handles settings UI
document.addEventListener('DOMContentLoaded', async () => {
  const statusIndicator = document.getElementById('status-indicator');
  const statusText = document.getElementById('status-text');
  const targetLanguage = document.getElementById('target-language');
  const enableTranslation = document.getElementById('enable-translation');
  const enableQA = document.getElementById('enable-qa');
  const saveButton = document.getElementById('save-settings');
  const startTranslationButton = document.getElementById('start-translation');

  // Load saved settings
  const settings = await chrome.storage.sync.get({
    targetLanguage: 'English',
    enableTranslation: false,
    enableQA: false
  });

  targetLanguage.value = settings.targetLanguage;
  enableTranslation.checked = settings.enableTranslation;
  enableQA.checked = settings.enableQA;

  // Check if current tab has video/audio elements
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab.url && (tab.url.startsWith('http://') || tab.url.startsWith('https://'))) {
    // Check if page has video elements
    try {
      const result = await chrome.tabs.sendMessage(tab.id, { action: 'checkForMedia' });
      if (result && result.hasMedia) {
        statusIndicator.classList.remove('inactive');
        statusIndicator.classList.add('active');
        statusText.textContent = 'Ready - Video detected';
      }
    } catch (e) {
      // Content script not loaded yet, that's ok
    }
  }

  // Start Translation - uses Web Audio API for reliable video audio capture
  startTranslationButton.addEventListener('click', async () => {
    try {
      console.log('🎬 Start Translation button clicked');

      // Get the current tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!tab || !tab.id) {
        throw new Error('No active tab found');
      }

      // Check if on a valid web page
      if (!tab.url || !(tab.url.startsWith('http://') || tab.url.startsWith('https://'))) {
        alert('Please navigate to a video page first.');
        return;
      }

      // Visual feedback - starting
      startTranslationButton.textContent = 'Starting...';
      startTranslationButton.disabled = true;

      // Get source language from settings
      const settings = await chrome.storage.sync.get({ sourceLanguage: 'en' });

      // Send message to content script to start Web Audio API capture
      chrome.tabs.sendMessage(tab.id, {
        action: 'startWebAudioCapture',
        sourceLanguage: settings.sourceLanguage
      }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('❌ Failed to send message:', chrome.runtime.lastError.message);
          startTranslationButton.textContent = 'Start Translation';
          startTranslationButton.disabled = false;
          alert('Failed to start translation. Make sure the page is fully loaded.');
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
          alert('Failed to start translation: ' + (response?.error || 'Video element not found. Make sure video is playing.'));
        }
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
      enableQA: enableQA.checked
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
