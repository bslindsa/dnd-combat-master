import { join } from 'node:path';
import express from 'express';
import { createAuthApp } from './app.mjs';

const port = Number(process.env.PORT ?? 3000);
const { app } = createAuthApp();
const browserPath = join(process.cwd(), 'dist/dnd-combat-master/browser');

app.use(express.static(browserPath));
app.get('*path', (_request, response) => response.sendFile(join(browserPath, 'index.html')));
app.listen(port, () => console.log(`Encounter Forge listening on http://localhost:${port}`));
