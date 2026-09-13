import { createServer } from 'node:http';
import { Server } from 'socket.io';

const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;

const httpServer = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }
  res.writeHead(404);
  res.end();
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const io = new Server(httpServer, {
  cors: { origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000' },
});

httpServer.listen(PORT, () => {
  console.log(`cabo realtime server listening on :${PORT}`);
});
