// Popup script - handles settings UI
document.addEventListener('DOMContentLoaded', async () => {
  const statusIndicator = document.getElementById('status-indicator');
  const statusText = document.getElementById('status-text');
  const targetLanguage = document.getElementById('target-language');
  const enableTranslation = document.getElementById('enable-translation');
  const enableQA = document.getElementById('enable-qa');
  const enableDubbing = document.getElementById('enable-dubbing');
  const saveButton = document.getElementById('save-settings');

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
