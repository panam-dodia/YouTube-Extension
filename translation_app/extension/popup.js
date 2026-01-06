document.getElementById('toggleBtn').addEventListener('click', async () => {
    const statusDiv = document.getElementById('status');

    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        // Inject the content script directly
        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content-v2.js']
        });

        statusDiv.textContent = 'Overlay injected!';
        statusDiv.className = 'status show';
        statusDiv.style.color = '#00ff88';

        setTimeout(() => window.close(), 1000);

    } catch (error) {
        statusDiv.textContent = 'Error: ' + error.message;
        statusDiv.className = 'status show';
        statusDiv.style.color = '#ff006e';
    }
});
