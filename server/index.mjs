import { join } from 'node:path';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { createAuthApp } from './app.mjs';

const port = Number(process.env.PORT ?? 3000);
const { app } = createAuthApp();
const browserPath = join(process.cwd(), 'dist/dnd-combat-master/browser');
const pageLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
});

app.use(pageLimiter, express.static(browserPath));
app.get('*path', pageLimiter, (_request, response) =>
  response.sendFile(join(browserPath, 'index.html')),
);
app.listen(port, () => console.log(`Encounter Forge listening on http://localhost:${port}`));
