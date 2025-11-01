#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { IsomorphicHeaders } from "@modelcontextprotocol/sdk/types.js";
import express, { Request, Response, Express } from "express";
import { z } from "zod";
import { randomBytes } from "crypto";
import { parseArgs as utilParseArgs } from "node:util";
import { Server } from "http";

// Configuration interface
export interface Config {
  secret: string;
  allowedUrlRegex: RegExp;
  allowedMethods: Set<string>;
  allowedToolHeaderNames: Set<string>;
  allowedPassthroughHeaderNames: Set<string>;
  fetchTimeout: number;
  fetchMaxResponseSize: number;
  port: number;
}

// Parse CLI arguments
function parseArgs(): Config {
  const { values } = utilParseArgs({
    options: {
      'secret': { type: 'string' },
      'allowed-url-regex': { type: 'string' },
      'allowed-methods': { type: 'string' },
      'allowed-tool-header-names': { type: 'string' },
      'allowed-passthrough-header-names': { type: 'string' },
      'fetch-timeout': { type: 'string' },
      'fetch-max-response-size': { type: 'string' },
      'port': { type: 'string' }
    },
    strict: false,
    allowPositionals: false
  });

  const secret = typeof values['secret'] === 'string' ? values['secret'] : undefined;
  const allowedUrlRegexStr = typeof values['allowed-url-regex'] === 'string' ? values['allowed-url-regex'] : undefined;
  const allowedMethodsStr = typeof values['allowed-methods'] === 'string' ? values['allowed-methods'] : undefined;
  const allowedToolHeaderNamesStr = typeof values['allowed-tool-header-names'] === 'string' ? values['allowed-tool-header-names'] : undefined;
  const allowedPassthroughHeaderNamesStr = typeof values['allowed-passthrough-header-names'] === 'string' ? values['allowed-passthrough-header-names'] : undefined;
  const fetchTimeoutStr = typeof values['fetch-timeout'] === 'string' ? values['fetch-timeout'] : undefined;
  const fetchMaxResponseSizeStr = typeof values['fetch-max-response-size'] === 'string' ? values['fetch-max-response-size'] : undefined;
  const portStr = typeof values['port'] === 'string' ? values['port'] : undefined;

  const config: Config = {
    secret: secret || randomBytes(32).toString("hex"),
    allowedUrlRegex: allowedUrlRegexStr
      ? new RegExp(allowedUrlRegexStr)
      : /^http:\/\/localhost(:[0-9]+)?(\/.*)?$/,
    allowedMethods: allowedMethodsStr
      ? new Set(allowedMethodsStr.split(",").map((m: string) => m.trim().toUpperCase()))
      : new Set(["GET"]),
    allowedToolHeaderNames: allowedToolHeaderNamesStr
      ? new Set(allowedToolHeaderNamesStr.split(",").map((h: string) => h.trim().toLowerCase()))
      : new Set(["content-type", "accept"]),
    allowedPassthroughHeaderNames: allowedPassthroughHeaderNamesStr
      ? new Set(allowedPassthroughHeaderNamesStr.split(",").map((h: string) => h.trim().toLowerCase()))
      : new Set([]),
    fetchTimeout: fetchTimeoutStr ? parseInt(fetchTimeoutStr, 10) : 30,
    fetchMaxResponseSize: fetchMaxResponseSizeStr ? parseInt(fetchMaxResponseSizeStr, 10) : 100,
    port: portStr ? parseInt(portStr, 10) : 3000,
  };

  return config;
}

// Generate random secret if not provided
const config = parseArgs();

// Log the secret to stderr for client configuration
console.error(`[fetch-mcp] Server starting...`);
console.error(`[fetch-mcp] Secret: ${config.secret}`);
console.error(`[fetch-mcp] Allowed URL regex: ${config.allowedUrlRegex.source}`);
console.error(`[fetch-mcp] Allowed methods: ${Array.from(config.allowedMethods).join(", ")}`);
console.error(`[fetch-mcp] Allowed tool headers: ${Array.from(config.allowedToolHeaderNames).join(", ")}`);
console.error(`[fetch-mcp] Allowed passthrough headers: ${Array.from(config.allowedPassthroughHeaderNames).join(", ") || "(none)"}`);
console.error(`[fetch-mcp] Fetch timeout: ${config.fetchTimeout}s`);
console.error(`[fetch-mcp] Max response size: ${config.fetchMaxResponseSize}KB`);

// Common Log Format logger
function logRequest(
  url: string,
  method: string,
  statusCode: number,
  responseSize: number,
  clientIp: string = "-"
) {
  const timestamp = new Date().toISOString();
  const urlObj = new URL(url);
  const path = urlObj.pathname + urlObj.search;
  const host = urlObj.host;

  // CLF format: <client-ip> - - [<timestamp>] "<method> <url-host><url-path> HTTP/1.1" <status> <bytes>
  console.error(
    `${clientIp} - - [${timestamp}] "${method} ${host}${path} HTTP/1.1" ${statusCode} ${responseSize}`
  );
}

// Validate URL and HTTP method against security constraints
export function validateRequest(
  url: string,
  method: string,
  config: Config
): {
  content: Array<{ type: "text"; text: string }>;
  structuredContent: { url: string; retrievedAt: string; statusCode: number };
  isError: true;
} | null {
  const retrievedAt = new Date().toISOString();

  // Validate URL
  if (!config.allowedUrlRegex.test(url)) {
    return {
      content: [
        {
          type: "text",
          text: `URL not allowed: ${url} does not match allowed regex ${config.allowedUrlRegex.source}`,
        },
      ],
      structuredContent: {
        url,
        retrievedAt,
        statusCode: -1,
      },
      isError: true,
    };
  }

  // Validate method
  const upperMethod = method.toUpperCase();
  if (!config.allowedMethods.has(upperMethod)) {
    return {
      content: [
        {
          type: "text",
          text: `Method not allowed: ${method}. Allowed methods: ${Array.from(config.allowedMethods).join(", ")}`,
        },
      ],
      structuredContent: {
        url,
        retrievedAt,
        statusCode: -1,
      },
      isError: true,
    };
  }

  return null; // Validation passed
}

// Merge and filter headers from both tool headers and passthrough headers from MCP request
export function mergeAndFilterHeaders(
  toolHeaders: Record<string, string> | undefined,
  passthroughHeaders: IsomorphicHeaders | undefined,
  config: Config
): Record<string, string> {
  const filteredHeaders: Record<string, string> = {};

  // First, add filtered passthrough headers from MCP request
  if (passthroughHeaders) {
    for (const [key, value] of Object.entries(passthroughHeaders)) {
      if (config.allowedPassthroughHeaderNames.has(key.toLowerCase())) {
        // Convert array values to comma-separated string
        const stringValue = Array.isArray(value) ? value.join(", ") : value;
        if (stringValue !== undefined) {
          filteredHeaders[key] = stringValue;
        }
      }
    }
  }

  // Then, add filtered tool headers (these take precedence)
  if (toolHeaders) {
    for (const [key, value] of Object.entries(toolHeaders)) {
      if (config.allowedToolHeaderNames.has(key.toLowerCase())) {
        filteredHeaders[key] = value;
      }
    }
  }

  return filteredHeaders;
}

// Perform HTTP fetch operation
export async function performFetch(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: string | undefined,
  config: Config
): Promise<{
  content: Array<
    | { type: "text"; text: string; mimeType?: string }
    | { type: "image"; data: string; mimeType: string }
  >;
  structuredContent?: {
    url: string;
    retrievedAt: string;
    statusCode: number;
    headers?: Record<string, string>;
  };
  isError?: boolean;
}> {
  const retrievedAt = new Date().toISOString();
  const upperMethod = method.toUpperCase();

  try {

    // Set up timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.fetchTimeout * 1000);

    try {
      // Perform fetch
      const response = await fetch(url, {
        method: upperMethod,
        headers: headers,
        body: body,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Get content type
      const contentType = response.headers.get("content-type") || "";
      const isImage = contentType.startsWith("image/") || contentType.startsWith("application/pdf");
      const isText = contentType.startsWith("text/") || contentType.includes("json") || contentType.includes("xml");

      // Read response with size limit
      let responseData: string;
      let truncated = false;
      const maxBytes = config.fetchMaxResponseSize * 1024;

      if (isImage || !isText) {
        // Binary content - read as buffer
        const buffer = await response.arrayBuffer();
        if (buffer.byteLength > maxBytes) {
          truncated = true;
          const limitedBuffer = buffer.slice(0, maxBytes);
          responseData = Buffer.from(limitedBuffer).toString("base64");
        } else {
          responseData = Buffer.from(buffer).toString("base64");
        }

        // Log request
        logRequest(url, upperMethod, response.status, buffer.byteLength);

        return {
          content: [
            {
              type: "image",
              data: truncated ? responseData + `\n(... truncated after ${config.fetchMaxResponseSize}KB)` : responseData,
              mimeType: contentType || "application/octet-stream",
            },
          ],
          structuredContent: {
            url,
            retrievedAt,
            statusCode: response.status,
            headers: Object.fromEntries(response.headers.entries()),
          },
        };
      } else {
        // Text content
        const text = await response.text();
        const sizeBytes = new TextEncoder().encode(text).length;

        if (sizeBytes > maxBytes) {
          truncated = true;
          // Truncate text by bytes
          const encoder = new TextEncoder();
          const decoder = new TextDecoder();
          const bytes = encoder.encode(text);
          responseData = decoder.decode(bytes.slice(0, maxBytes)) + `\n(... truncated after ${config.fetchMaxResponseSize}KB)`;
        } else {
          responseData = text;
        }

        // Log request
        logRequest(url, upperMethod, response.status, sizeBytes);

        return {
          content: [
            {
              type: "text",
              text: responseData,
              mimeType: contentType || "text/plain",
            },
          ],
          structuredContent: {
            url,
            retrievedAt,
            statusCode: response.status,
            headers: Object.fromEntries(response.headers.entries()),
          },
        };
      }
    } catch (fetchError: any) {
      clearTimeout(timeoutId);

      // Log failed request
      logRequest(url, upperMethod, -1, 0);

      const errorMessage = fetchError.name === "AbortError"
        ? `Request timeout after ${config.fetchTimeout}s`
        : `Failed to fetch URL: ${fetchError.message}`;

      return {
        content: [
          {
            type: "text",
            text: errorMessage,
          },
        ],
        structuredContent: {
          url,
          retrievedAt,
          statusCode: -1,
        },
        isError: true,
      };
    }
  } catch (error: any) {
    // Log failed request
    logRequest(url, method, -1, 0);

    return {
      content: [
        {
          type: "text",
          text: `Error: ${error.message}`,
        },
      ],
      structuredContent: {
        url,
        retrievedAt,
        statusCode: -1,
      },
      isError: true,
    };
  }
}

// Create and configure the MCP server and Express app
export async function createServer(config: Config): Promise<{
  app: Express;
  server: McpServer;
  transport: StreamableHTTPServerTransport;
  httpServer?: Server;
}> {
  // Create MCP server
  const server = new McpServer({
    name: "fetch-mcp",
    version: "1.0.0",
  });

  // Register web_fetch tool
  server.tool(
    "web_fetch",
    "Fetch a URL over HTTP with configurable security constraints",
    {
      url: z.string().url().describe("The URL to fetch"),
      method: z.string().optional().describe("HTTP method (GET, POST, etc.)"),
      headers: z.record(z.string()).optional().describe("HTTP headers to include"),
      body: z.string().optional().describe("Request body for POST/PUT requests"),
    },
    async ({ url, method = "GET", headers, body }, extra) => {
      // Validate URL and HTTP method
      const validationError = validateRequest(url, method, config);
      if (validationError) {
        return validationError;
      }

      // Merge and filter headers from both tool params and MCP request
      const filteredHeaders = mergeAndFilterHeaders(headers, extra.requestInfo?.headers, config);

      // Perform fetch with filtered headers
      return await performFetch(url, method, filteredHeaders, body, config);
    }
  );

  // Create Express app
  const app = express();
  app.use(express.json());

  // Secret validation middleware
  app.use((req: Request, res: Response, next) => {
    const providedSecret = req.headers["x-webfetchmcp-secret"];

    if (providedSecret !== config.secret) {
      res.status(401).json({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Authentication failed: Invalid or missing X-WebFetchMcp-Secret header"
        },
        id: null
      });
      return;
    }

    next();
  });

  // Create transport
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // Stateless server
  });

  // Connect server to transport
  await server.connect(transport);

  // Handle MCP requests
  app.post("/mcp", async (req: Request, res: Response) => {
    await transport.handleRequest(req, res, req.body);
  });

  return { app, server, transport };
}

// Main execution (only runs when file is executed directly)
if (import.meta.url === `file://${process.argv[1]}`) {
  const config = parseArgs();

  // Log the secret to stderr for client configuration
  console.error(`[fetch-mcp] Server starting...`);
  console.error(`[fetch-mcp] Secret: ${config.secret}`);
  console.error(`[fetch-mcp] Allowed URL regex: ${config.allowedUrlRegex.source}`);
  console.error(`[fetch-mcp] Allowed methods: ${Array.from(config.allowedMethods).join(", ")}`);
  console.error(`[fetch-mcp] Allowed tool headers: ${Array.from(config.allowedToolHeaderNames).join(", ")}`);
  console.error(`[fetch-mcp] Allowed passthrough headers: ${Array.from(config.allowedPassthroughHeaderNames).join(", ") || "(none)"}`);
  console.error(`[fetch-mcp] Fetch timeout: ${config.fetchTimeout}s`);
  console.error(`[fetch-mcp] Max response size: ${config.fetchMaxResponseSize}KB`);

  const { app } = await createServer(config);

  // Start server
  app.listen(config.port, () => {
    console.error(`[fetch-mcp] Server listening on port ${config.port}`);
    console.error(`[fetch-mcp] MCP endpoint: http://localhost:${config.port}/mcp`);
  });
}
