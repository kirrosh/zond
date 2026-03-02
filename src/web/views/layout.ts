let _devMode = false;

export function setDevMode(enabled: boolean): void {
  _devMode = enabled;
}

export function layout(title: string, content: string): string {
  const devScript = _devMode
    ? `<script>new EventSource('/dev/reload').onmessage = (e) => { if (e.data === 'reload') location.reload() }</script>`
    : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} — apitool</title>
  <link rel="stylesheet" href="/static/style.css">
  <script src="/static/htmx.min.js"></script>
  <script>htmx.config.refreshOnHistoryMiss = true;</script>
</head>
<body>
  <nav class="navbar">
    <a href="/" class="nav-brand" style="text-decoration:none;color:inherit;">apitool</a>
  </nav>
  <main class="container">
    ${content}
  </main>
  <footer class="footer">
    <div class="container">apitool v0.1.0</div>
  </footer>
  ${devScript}
</body>
</html>`;
}

export function fragment(content: string): string {
  return content;
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
