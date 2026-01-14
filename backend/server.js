import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import translationRoutes from './routes/translation.routes.js';
import waitlistRoutes from './routes/waitlist.routes.js';
import trialRoutes from './routes/trial.routes.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' })); // Increase limit for audio data

// Root route for AWS ELB health checks
app.get('/', (req, res) => {
  res.json({ status: 'OK', message: 'TalkBridge Backend', version: '1.0.0' });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'YouTube Extension Backend is running' });
});

// Routes
app.use('/api/translation', translationRoutes);
app.use('/api/waitlist', waitlistRoutes);
app.use('/api/trial', trialRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: err.message
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
});
