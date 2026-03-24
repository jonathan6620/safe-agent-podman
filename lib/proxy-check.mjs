import http from "node:http";

/**
 * Check if the auth proxy is reachable.
 * Returns true if it responds within the timeout.
 */
export function checkProxy(port = 8080, host = "127.0.0.1", timeoutMs = 2000) {
  return new Promise((resolve) => {
    const req = http.get({ host, port, path: "/", timeout: timeoutMs }, () => {
      resolve(true);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}
