import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createServer, Config } from '../index.js';
import { createMockHttpServer, startExpressApp } from './helpers.js';
import { Express } from 'express';
import { Server } from 'http';

describe('MCP Server E2E Tests', () => {
  let mockHttpServer: Awaited<ReturnType<typeof createMockHttpServer>>;
  let mcpApp: Express;
  let mcpHttpServer: Server;
  let mcpPort: number;
  let config: Config;

  beforeAll(async () => {
    // Start mock HTTP server (target for fetch requests)
    mockHttpServer = await createMockHttpServer(8888);

    // Create MCP server configuration
    config = {
      secret: 'test-secret-123',
      allowedUrlRegex: /^http:\/\/localhost:8888(\/.*)?$/,
      allowedMethods: new Set(['GET', 'POST']),
      allowedToolHeaderNames: new Set(['content-type', 'user-agent']),
      allowedPassthroughHeaderNames: new Set(['authorization']),
      fetchTimeout: 10,
      fetchMaxResponseSize: 100,
      port: 0, // Will be assigned dynamically
    };

    // Create and start MCP server
    const { app } = await createServer(config);
    mcpApp = app;
    const { httpServer, port } = await startExpressApp(app);
    mcpHttpServer = httpServer;
    mcpPort = port;
  });

  afterAll(async () => {
    // Clean up servers
    await mockHttpServer.close();
    await new Promise<void>((resolve) => {
      mcpHttpServer.close(() => resolve());
    });
  });

  describe('Happy Path', () => {
    it('should successfully fetch with tool headers and passthrough headers', async () => {
      const response = await request(mcpApp)
        .post('/mcp')
        .set('Content-Type', 'application/json')
        .set('Accept', 'application/json, text/event-stream')
        .set('X-WebFetchMcp-Secret', config.secret)
        .set('Authorization', 'Bearer test-token-123')
        .send({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'web_fetch',
            arguments: {
              url: 'http://localhost:8888/test',
              method: 'GET',
              headers: {
                'User-Agent': 'TestClient/1.0',
                'Content-Type': 'application/json',
              },
            },
          },
        });

      // Should return success
      expect(response.status).toBe(200);

      // Parse SSE response
      const lines = response.text.split('\n');
      const dataLine = lines.find(line => line.startsWith('data: '));
      expect(dataLine).toBeDefined();
      const data = JSON.parse(dataLine!.substring(6));

      // Verify response structure
      expect(data.result).toBeDefined();
      expect(data.result.content).toBeDefined();
      expect(data.result.content[0].type).toBe('text');
      expect(data.result.structuredContent.statusCode).toBe(200);

      // Verify the mock server received the correct headers
      const receivedRequest = mockHttpServer.receivedRequests[mockHttpServer.receivedRequests.length - 1];
      expect(receivedRequest).toBeDefined();

      // Tool headers should be present
      expect(receivedRequest.headers['user-agent']).toBe('TestClient/1.0');
      expect(receivedRequest.headers['content-type']).toBe('application/json');

      // Passthrough header should be present
      expect(receivedRequest.headers['authorization']).toBe('Bearer test-token-123');
    });
  });

  describe('Negative Tests - CLI Option Validation', () => {
    it('should reject requests to disallowed URLs', async () => {
      const response = await request(mcpApp)
        .post('/mcp')
        .set('Content-Type', 'application/json')
        .set('Accept', 'application/json, text/event-stream')
        .set('X-WebFetchMcp-Secret', config.secret)
        .send({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'web_fetch',
            arguments: {
              url: 'http://evil.com/malicious',
              method: 'GET',
            },
          },
        });

      expect(response.status).toBe(200);
      const lines = response.text.split('\n');
      const dataLine = lines.find(line => line.startsWith('data: '));
      const data = JSON.parse(dataLine!.substring(6));

      // Should return error
      expect(data.result.isError).toBe(true);
      expect(data.result.content[0].text).toContain('URL not allowed');
      expect(data.result.structuredContent.statusCode).toBe(-1);
    });

    it('should reject requests with disallowed HTTP methods', async () => {
      const response = await request(mcpApp)
        .post('/mcp')
        .set('Content-Type', 'application/json')
        .set('Accept', 'application/json, text/event-stream')
        .set('X-WebFetchMcp-Secret', config.secret)
        .send({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'web_fetch',
            arguments: {
              url: 'http://localhost:8888/test',
              method: 'DELETE', // Not in allowed methods (GET, POST)
            },
          },
        });

      expect(response.status).toBe(200);
      const lines = response.text.split('\n');
      const dataLine = lines.find(line => line.startsWith('data: '));
      const data = JSON.parse(dataLine!.substring(6));

      // Should return error
      expect(data.result.isError).toBe(true);
      expect(data.result.content[0].text).toContain('Method not allowed');
      expect(data.result.structuredContent.statusCode).toBe(-1);
    });

    it('should filter out disallowed tool headers', async () => {
      const initialRequestCount = mockHttpServer.receivedRequests.length;

      const response = await request(mcpApp)
        .post('/mcp')
        .set('Content-Type', 'application/json')
        .set('Accept', 'application/json, text/event-stream')
        .set('X-WebFetchMcp-Secret', config.secret)
        .send({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'web_fetch',
            arguments: {
              url: 'http://localhost:8888/test',
              method: 'GET',
              headers: {
                'User-Agent': 'TestClient/1.0', // Allowed
                'X-Custom-Header': 'should-be-filtered', // Not allowed
              },
            },
          },
        });

      expect(response.status).toBe(200);

      // Verify the disallowed header was filtered out
      const receivedRequest = mockHttpServer.receivedRequests[initialRequestCount];
      expect(receivedRequest.headers['user-agent']).toBe('TestClient/1.0');
      expect(receivedRequest.headers['x-custom-header']).toBeUndefined();
    });

    it('should filter out disallowed passthrough headers', async () => {
      const initialRequestCount = mockHttpServer.receivedRequests.length;

      const response = await request(mcpApp)
        .post('/mcp')
        .set('Content-Type', 'application/json')
        .set('Accept', 'application/json, text/event-stream')
        .set('X-WebFetchMcp-Secret', config.secret)
        .set('Authorization', 'Bearer test-token') // Allowed
        .set('X-Forbidden-Header', 'should-be-filtered') // Not allowed
        .send({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'web_fetch',
            arguments: {
              url: 'http://localhost:8888/test',
              method: 'GET',
            },
          },
        });

      expect(response.status).toBe(200);

      // Verify the allowed passthrough header was included
      const receivedRequest = mockHttpServer.receivedRequests[initialRequestCount];
      expect(receivedRequest.headers['authorization']).toBe('Bearer test-token');

      // Verify the disallowed header was filtered out
      expect(receivedRequest.headers['x-forbidden-header']).toBeUndefined();
    });

    it('should reject requests without valid authentication', async () => {
      const response = await request(mcpApp)
        .post('/mcp')
        .set('Content-Type', 'application/json')
        .set('Accept', 'application/json, text/event-stream')
        .set('X-WebFetchMcp-Secret', 'wrong-secret')
        .send({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'web_fetch',
            arguments: {
              url: 'http://localhost:8888/test',
              method: 'GET',
            },
          },
        });

      // Should return 401 Unauthorized
      expect(response.status).toBe(401);
      expect(response.body.error).toBeDefined();
      expect(response.body.error.message).toContain('Authentication failed');
    });
  });
});
