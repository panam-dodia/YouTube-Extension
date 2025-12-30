// Popup script - STANDALONE (No Backend)
document.addEventListener('DOMContentLoaded', async () => {
  const statusIndicator = document.getElementById('status-indicator');
  const statusText = document.getElementById('status-text');
  const geminiApiKey = document.getElementById('gemini-api-key');
  const enableQA = document.getElementById('enable-qa');
  const saveButton = document.getElementById('save-settings');

  // Load saved settings
  const settings = await chrome.storage.sync.get({
    geminiApiKey: '',
    enableQA: false
  });

  geminiApiKey.value = settings.geminiApiKey;
  enableQA.checked = settings.enableQA;

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
      geminiApiKey: geminiApiKey.value.trim(),
      enableQA: enableQA.checked
    };

    if (enableQA.checked && !newSettings.geminiApiKey) {
      alert('Please enter your Gemini API key to use Q&A feature');
      return;
    }

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