import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Simple file-based storage for waitlist
const WAITLIST_FILE = path.join(__dirname, '../data/waitlist.json');

// Ensure data directory exists
const dataDir = path.join(__dirname, '../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Initialize waitlist file if it doesn't exist
if (!fs.existsSync(WAITLIST_FILE)) {
  fs.writeFileSync(WAITLIST_FILE, JSON.stringify([], null, 2));
}

/**
 * Register email for waitlist
 */
router.post('/register', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Valid email required' });
    }

    // Read current waitlist
    const waitlistData = fs.readFileSync(WAITLIST_FILE, 'utf8');
    const waitlist = JSON.parse(waitlistData);

    // Check if already registered
    const existing = waitlist.find(entry => entry.email === email);
    if (existing) {
      return res.json({
        message: 'Already registered',
        registeredAt: existing.registeredAt
      });
    }

    // Add to waitlist
    const newEntry = {
      email,
      registeredAt: new Date().toISOString(),
      source: 'chrome-extension'
    };

    waitlist.push(newEntry);

    // Save to file
    fs.writeFileSync(WAITLIST_FILE, JSON.stringify(waitlist, null, 2));

    console.log(`✅ Waitlist registration: ${email} (Total: ${waitlist.length})`);

    res.json({
      message: 'Successfully registered',
      email,
      registeredAt: newEntry.registeredAt
    });

  } catch (error) {
    console.error('Waitlist registration error:', error);
    res.status(500).json({ error: 'Failed to register' });
  }
});

/**
 * Get waitlist count (for admin/analytics)
 */
router.get('/count', (req, res) => {
  try {
    const waitlistData = fs.readFileSync(WAITLIST_FILE, 'utf8');
    const waitlist = JSON.parse(waitlistData);

    res.json({ count: waitlist.length });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get count' });
  }
});

export default router;
