import net from 'node:net';

const firstPort = Number.parseInt(process.argv[2] ?? '4173', 10);
const lastPort = Number.parseInt(process.argv[3] ?? String(firstPort + 26), 10);

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', () => resolve(false));
    server.listen({ host: '127.0.0.1', port }, () => {
      server.close(() => resolve(true));
    });
  });
}

let availablePort = null;
for (let port = firstPort; port <= lastPort; port += 1) {
  if (await isPortAvailable(port)) {
    availablePort = port;
    break;
  }
}

if (availablePort === null) process.exitCode = 1;
else process.stdout.write(String(availablePort));
