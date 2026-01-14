import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Developer whitelist - these emails bypass all trial restrictions
const DEVELOPER_EMAILS = [
  'panamdodia945@gmail.com'
];

// Simple file-based storage for trials
const TRIALS_FILE = path.join(__dirname, '../data/trials.json');

// Ensure data directory exists
const dataDir = path.join(__dirname, '../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Initialize trials file if it doesn't exist
if (!fs.existsSync(TRIALS_FILE)) {
  fs.writeFileSync(TRIALS_FILE, JSON.stringify([], null, 2));
}

/**
 * Start a new trial - validates email and device haven't been used before
 */
router.post('/start', async (req, res) => {
  try {
    const { email, deviceFingerprint, deviceInfo } = req.body;

    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Valid email required' });
    }

    if (!deviceFingerprint) {
      return res.status(400).json({ error: 'Device fingerprint required' });
    }

    // Check if this is a developer email (bypass restrictions)
    const isDeveloper = DEVELOPER_EMAILS.includes(email.toLowerCase());

    // Read current trials
    const trialsData = fs.readFileSync(TRIALS_FILE, 'utf8');
    const trials = JSON.parse(trialsData);

    if (!isDeveloper) {
      // Check if email has already been used
      const existingEmail = trials.find(trial => trial.email === email);
      if (existingEmail) {
        console.log(`⚠️ Trial blocked: Email already used - ${email}`);
        return res.status(409).json({
          error: 'Email already used',
          message: 'This email has already been used for a trial'
        });
      }

      // Check if device fingerprint has already been used
      const existingDevice = trials.find(trial => trial.deviceFingerprint === deviceFingerprint);
      if (existingDevice) {
        console.log(`⚠️ Trial blocked: Device already used - ${deviceFingerprint}`);
        return res.status(409).json({
          error: 'Device already used',
          message: 'This device has already been used for a trial'
        });
      }
    } else {
      console.log(`🔧 Developer email detected: ${email} - bypassing all restrictions`);
    }

    // Create new trial entry
    const newTrial = {
      email,
      deviceFingerprint,
      deviceInfo,
      startedAt: new Date().toISOString(),
      source: 'chrome-extension',
      status: 'active'
    };

    trials.push(newTrial);

    // Save to file
    fs.writeFileSync(TRIALS_FILE, JSON.stringify(trials, null, 2));

    console.log(`✅ New trial started: ${email} (Total trials: ${trials.length})`);

    res.json({
      message: 'Trial started successfully',
      email,
      startedAt: newTrial.startedAt,
      trialDays: 7
    });

  } catch (error) {
    console.error('Trial start error:', error);
    res.status(500).json({ error: 'Failed to start trial' });
  }
});

/**
 * Validate if a trial is still valid (optional endpoint for future use)
 */
router.post('/validate', async (req, res) => {
  try {
    const { email, deviceFingerprint } = req.body;

    if (!email || !deviceFingerprint) {
      return res.status(400).json({ error: 'Email and device fingerprint required' });
    }

    // Read current trials
    const trialsData = fs.readFileSync(TRIALS_FILE, 'utf8');
    const trials = JSON.parse(trialsData);

    // Find trial
    const trial = trials.find(t => t.email === email && t.deviceFingerprint === deviceFingerprint);

    if (!trial) {
      return res.status(404).json({ error: 'Trial not found' });
    }

    // Calculate days since trial start
    const startDate = new Date(trial.startedAt);
    const now = new Date();
    const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
    const daysRemaining = 7 - daysSinceStart;
    const isActive = daysRemaining > 0;

    res.json({
      email: trial.email,
      startedAt: trial.startedAt,
      daysSinceStart,
      daysRemaining: Math.max(0, daysRemaining),
      isActive,
      status: trial.status
    });

  } catch (error) {
    console.error('Trial validation error:', error);
    res.status(500).json({ error: 'Failed to validate trial' });
  }
});

/**
 * Get trial statistics (for admin/analytics)
 */
router.get('/stats', (req, res) => {
  try {
    const trialsData = fs.readFileSync(TRIALS_FILE, 'utf8');
    const trials = JSON.parse(trialsData);

    const now = new Date();
    const activeTrials = trials.filter(trial => {
      const startDate = new Date(trial.startedAt);
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      return daysSinceStart < 7;
    });

    res.json({
      total: trials.length,
      active: activeTrials.length,
      expired: trials.length - activeTrials.length
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

export default router;
