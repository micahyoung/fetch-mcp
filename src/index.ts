#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { Request, Response } from "express";
import { z } from "zod";
import { randomBytes } from "crypto";

// Configuration interface
interface Config {
  secret: string;
  allowedUrlRegex: RegExp;
  allowedMethods: Set<string>;
  allowedHeaderNames: Set<string>;
  fetchTimeout: number;
  fetchMaxResponseSize: number;
  port: number;
}

// Parse CLI arguments
function parseArgs(): Config {
  const args = process.argv.slice(2);
  const config: Config = {
    secret: randomBytes(32).toString("hex"),
    allowedUrlRegex: /^http:\/\/localhost(:[0-9]+)?(\/.*)?$/,
    allowedMethods: new Set(["GET"]),
    allowedHeaderNames: new Set(["authorization", "content-type", "accept", "user-agent"]),
    fetchTimeout: 30,
    fetchMaxResponseSize: 100,
    port: 3000,
  };

  for (const arg of args) {
    if (arg.startsWith("--secret=")) {
      config.secret = arg.slice(9);
    } else if (arg.startsWith("--allowed-url-regex=")) {
      config.allowedUrlRegex = new RegExp(arg.slice(20));
    } else if (arg.startsWith("--allowed-methods=")) {
      const methods = arg.slice(18).split(",").map(m => m.trim().toUpperCase());
      config.allowedMethods = new Set(methods);
    } else if (arg.startsWith("--allowed-header-names=")) {
      const headers = arg.slice(23).split(",").map(h => h.trim().toLowerCase());
      config.allowedHeaderNames = new Set(headers);
    } else if (arg.startsWith("--fetch-timeout=")) {
      config.fetchTimeout = parseInt(arg.slice(16), 10);
    } else if (arg.startsWith("--fetch-max-response-size=")) {
      config.fetchMaxResponseSize = parseInt(arg.slice(26), 10);
    } else if (arg.startsWith("--port=")) {
      config.port = parseInt(arg.slice(7), 10);
    }
  }

  return config;
}

// Generate random secret if not provided
const config = parseArgs();

// Log the secret to stderr for client configuration
console.error(`[fetch-mcp] Server starting...`);
console.error(`[fetch-mcp] Secret: ${config.secret}`);
console.error(`[fetch-mcp] Allowed URL regex: ${config.allowedUrlRegex.source}`);
console.error(`[fetch-mcp] Allowed methods: ${Array.from(config.allowedMethods).join(", ")}`);
console.error(`[fetch-mcp] Allowed headers: ${Array.from(config.allowedHeaderNames).join(", ")}`);
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

// Validate and fetch URL
async function performFetch(
  url: string,
  method: string,
  headers: Record<string, string> | undefined,
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

  try {
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

    // Filter headers (case-insensitive)
    const filteredHeaders: Record<string, string> = {};
    if (headers) {
      for (const [key, value] of Object.entries(headers)) {
        if (config.allowedHeaderNames.has(key.toLowerCase())) {
          filteredHeaders[key] = value;
        }
      }
    }

    // Set up timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.fetchTimeout * 1000);

    try {
      // Perform fetch
      const response = await fetch(url, {
        method: upperMethod,
        headers: filteredHeaders,
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
  async ({ url, method = "GET", headers, body }) => {
    // Perform fetch
    return await performFetch(url, method, headers, body, config);
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

// Start server
app.listen(config.port, () => {
  console.error(`[fetch-mcp] Server listening on port ${config.port}`);
  console.error(`[fetch-mcp] MCP endpoint: http://localhost:${config.port}/mcp`);
});
