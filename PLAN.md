# Web Fetch MCP

* Equips any agent with a `web_fetch` tool, with configurable deploy-time and runtime settings.
* Transparent proxy for HTTP requests over MCP protocol.
* Has a single tool, `web_fetch`, approximating [fetch API](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API), with similar interface and options: `url`, `method`, `headers`, `body`.
* Stateless with no `signal`, `cache` nor `keepalive` options.
* Implemented in TypeScript/NodeJS with `@modelcontextprotocol/sdk` library [docs](https://modelcontextprotocol.io/docs/develop/build-server#node) calling native `fetch()`.
* Secure defaults including:
  * Required shared secret:
    * Server: randomly generated and logged at startup (default), or CLI option `--secret=<secret>`
    * Clients: must pass header that matches server's secret `X-WebFetchMcp-Secret: <secret>`
  * Allowlist for URLs:
    * Server: `^http:\/\/localhost(:[0-9]+)?(\/.*)?$` (default), or CLI option `--allowed-url-regex=<regex>`
    * Clients: can only fetch matching URLs: `Fetch("http://localhost:8000")`
  * Allowlist for Methods:
    * Server: `GET` (default), or CLI option `--allowed-methods=GET,POST`
    * Clients: can only send requests with matching methods
  * Allowlist for headers to pass through:
    * `Authorization, Content-Type, Accept, User-Agent` (default), or CLI option `--allowed-header-names=Authorization,Cookie`
    * Case-insensitive
  * Timeout is 30s (default), or CLI option `--fetch-timeout=<secs>`
  * Max response body size:
    * `100` KB (default), or CLI option `--fetch-max-response-size=<num KBs>`
    * Excess response content is cut off, with `(... truncated after <num KBs>KBs)` instead
* Transports: http-streamable only
* Responses:
  * Successful JSON response with tool:
    ```json
    {
        "content": [
            {
                "type": "text",
                "text": "{\"users\": [...]}",
                "mimeType": "application/json"
            }
        ],
        "structuredContent": {
            "url": "https://example.com/api/users",
            "retrievedAt": "2025-08-25T10:30:02Z",
            "statusCode": 200,
            "headers": {
                "content-type": "application/json",
                "content-length": "1024"
            }
        }
    }
    ```
  * Successful image response with tool:
    ```json
    {
        "content": [
            {
                "type": "image",
                "data": "JVBERi0xLjQKJcOk...",
                "mimeType": "application/pdf"
            }
        ],
        "structuredContent": {
            "url": "https://example.com/paper.pdf",
            "retrievedAt": "2025-08-25T10:30:02Z",
            "statusCode": 200
        }
    }
    ```
  * Failed responses with tool:
    ```json
    {
        "content": [
            {
                "type": "text",
                "text": "Failed to fetch URL: failed to connect"
            }
        ],
        "structuredContent": {
            "url": "https://notexisting.off/",
            "retrievedAt": "2025-08-25T10:30:02Z",
            "statusCode": -1
        },
        "isError": true
    }
    ```
  
* Logs:
  * Common Log Format, but with URL hosts + paths in request line
  * Write to stderr
