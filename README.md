# web-fetch-mcp

A Model Context Protocol (MCP) server that provides a `web_fetch` tool for making HTTP requests with configurable security constraints.

## Features

- **Single `web_fetch` tool** - Approximates the [Fetch API](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API) with similar interface. Inspired by Claude Code's internal [Web Fetch](https://docs.claude.com/en/docs/agents-and-tools/tool-use/web-fetch-tool).
- **Streamable HTTP transport** - Runs as an HTTP server accessible over the network
- **Security controls**:
  - Shared secret for MCP client-to-server authentication
  - allowlist for URLs
  - allowlist for HTTP Methods
  - allowlist for Headers
  - Request timeout
  - Response size limits

## Installation

```bash
npm install
npm run build
```

## Usage

### Starting the Server

```bash
# Start with default settings (auto-generated secret, localhost-only URLs)
node build/index.js

# Start with custom configuration
node build/index.js \
  --secret=my-secret-key \
  --port=3000 \
  --allowed-url-regex="^https?://api\.example\.com/.*" \
  --allowed-methods=GET,POST \
  --allowed-header-names=Authorization,Content-Type \
  --fetch-timeout=30 \
  --fetch-max-response-size=100
```

### CLI Options

| Option | Default | Description |
|--------|---------|-------------|
| `--secret=<string>` | Auto-generated | Shared secret for authentication |
| `--port=<number>` | `3000` | HTTP server port |
| `--allowed-url-regex=<regex>` | `^http://localhost(:[0-9]+)?(/.*)?$` | Regex pattern for allowed URLs |
| `--allowed-methods=<csv>` | `GET` | Comma-separated list of allowed HTTP methods |
| `--allowed-header-names=<csv>` | `Authorization,Content-Type,Accept,User-Agent` | Comma-separated list of allowed headers (case-insensitive) |
| `--fetch-timeout=<seconds>` | `30` | Request timeout in seconds |
| `--fetch-max-response-size=<KB>` | `100` | Maximum response size in kilobytes |

### MCP Tool: `web_fetch`

#### Authentication

All requests to the MCP server must include the `X-WebFetchMcp-Secret` header with the correct secret:

```bash
curl -H "X-WebFetchMcp-Secret: your-secret-key" ...
```

#### Parameters

- `url` (string, required): The URL to fetch
- `method` (string, optional): HTTP method (default: GET)
- `headers` (object, optional): HTTP headers to include
- `body` (string, optional): Request body for POST/PUT requests

#### Example Request

```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "X-WebFetchMcp-Secret: your-secret-key" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "web_fetch",
      "arguments": {
        "url": "http://localhost:8080/api/data",
        "method": "GET",
        "headers": {
          "Authorization": "Bearer token123",
          "Content-Type": "application/json"
        }
      }
    }
  }'
```

#### Response Format

**Successful Text/JSON Response:**
```json
{
  "content": [
    {
      "type": "text",
      "text": "{\"result\": \"data\"}",
      "mimeType": "application/json"
    }
  ],
  "structuredContent": {
    "url": "http://localhost:8080/api/data",
    "retrievedAt": "2025-11-01T12:00:00Z",
    "statusCode": 200,
    "headers": {
      "content-type": "application/json",
      "content-length": "1024"
    }
  }
}
```

**Successful Binary/Image Response:**
```json
{
  "content": [
    {
      "type": "image",
      "data": "base64-encoded-data...",
      "mimeType": "image/png"
    }
  ],
  "structuredContent": {
    "url": "http://localhost:8080/image.png",
    "retrievedAt": "2025-11-01T12:00:00Z",
    "statusCode": 200
  }
}
```

**Error Response:**
```json
{
  "content": [
    {
      "type": "text",
      "text": "Failed to fetch URL: connection refused"
    }
  ],
  "structuredContent": {
    "url": "http://localhost:8080/api/data",
    "retrievedAt": "2025-11-01T12:00:00Z",
    "statusCode": -1
  },
  "isError": true
}
```

## Security

The server implements multiple security layers:

1. **Secret Authentication**: All MCP requests must include the `X-WebFetchMcp-Secret` HTTP header matching the server's secret. Requests without this header or with an incorrect secret are rejected with a 401 error before reaching the MCP layer.
2. **URL Filtering**: Only URLs matching the regex pattern are allowed
3. **Method Filtering**: Only specified HTTP methods are permitted
4. **Header Filtering**: Only whitelisted headers are passed through to the target URL (case-insensitive)
5. **Timeouts**: Requests are automatically aborted after the configured timeout
6. **Size Limits**: Response bodies are truncated if they exceed the maximum size

## Logging

All requests are logged to stderr in Common Log Format:

```
- - - [2025-11-01T12:00:00.000Z] "GET api.example.com/data HTTP/1.1" 200 1024
```

Format: `<client-ip> - - [<timestamp>] "<method> <url-host><url-path> HTTP/1.1" <status> <bytes>`

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run in development mode
npm run dev
```

## License

Apache-2.0
