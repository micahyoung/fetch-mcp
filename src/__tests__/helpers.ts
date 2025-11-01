import http from 'http';
import { Express } from 'express';
import { Server } from 'http';

/**
 * Creates a simple HTTP server that echoes request information
 * Useful for testing the MCP server's HTTP fetch functionality
 */
export function createMockHttpServer(port: number = 0): Promise<{
  server: Server;
  port: number;
  receivedRequests: Array<{
    method: string;
    url: string;
    headers: http.IncomingHttpHeaders;
    body?: string;
  }>;
  close: () => Promise<void>;
}> {
  const receivedRequests: Array<{
    method: string;
    url: string;
    headers: http.IncomingHttpHeaders;
    body?: string;
  }> = [];

  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = '';

      req.on('data', (chunk) => {
        body += chunk.toString();
      });

      req.on('end', () => {
        // Record the request
        receivedRequests.push({
          method: req.method || 'GET',
          url: req.url || '/',
          headers: req.headers,
          body: body || undefined,
        });

        // Send back a JSON response
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          method: req.method,
          url: req.url,
          headers: req.headers,
          body: body || undefined,
        }));
      });
    });

    server.listen(port, () => {
      const address = server.address();
      const actualPort = typeof address === 'object' && address !== null ? address.port : port;

      resolve({
        server,
        port: actualPort,
        receivedRequests,
        close: () => new Promise((resolveClose) => {
          server.close(() => resolveClose());
        }),
      });
    });
  });
}

/**
 * Starts an Express app on a random available port
 */
export async function startExpressApp(app: Express): Promise<{
  httpServer: Server;
  port: number;
  close: () => Promise<void>;
}> {
  return new Promise((resolve) => {
    const httpServer = app.listen(0, () => {
      const address = httpServer.address();
      const port = typeof address === 'object' && address !== null ? address.port : 3000;

      resolve({
        httpServer,
        port,
        close: () => new Promise((resolveClose) => {
          httpServer.close(() => resolveClose());
        }),
      });
    });
  });
}

/**
 * Helper to make authenticated MCP requests
 */
export function makeAuthenticatedRequest(
  port: number,
  secret: string,
  toolName: string,
  args: Record<string, any>,
  additionalHeaders: Record<string, string> = {}
) {
  return {
    method: 'POST',
    url: `http://localhost:${port}/mcp`,
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'X-WebFetchMcp-Secret': secret,
      ...additionalHeaders,
    },
    body: {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: args,
      },
    },
  };
}
