import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import templatesRouter from './routes/templates.js';
import reportsRouter from './routes/reports.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;
const uploadsDir = path.resolve(process.cwd(), 'uploads');

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Serve uploaded files
app.use('/uploads', express.static(uploadsDir));

// API routes
app.use('/api/templates', templatesRouter);
app.use('/api/reports', reportsRouter);

// Serve static frontend in production
const clientDist = path.resolve(__dirname, '../../client/dist');
app.use(express.static(clientDist));
app.get('*', (_req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
