let _devMode = false;

export function setDevMode(enabled: boolean): void {
  _devMode = enabled;
}

export function layout(title: string, content: string, navExtra = ""): string {
  const devScript = _devMode
    ? `<script>new EventSource('/dev/reload').onmessage = (e) => { if (e.data === 'reload') location.reload() }</script>`
    : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} — zond</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/static/style.css?v=${Date.now()}">
  <script src="/static/htmx.min.js"></script>
  <script>htmx.config.refreshOnHistoryMiss = true;</script>
</head>
<body>
  <nav class="navbar">
    <a href="/" class="nav-brand" style="text-decoration:none;color:inherit;"><span class="logo-dot"></span>zond</a>
    ${navExtra}
  </nav>
  <main class="main-container">
    ${content}
  </main>
  <footer class="footer"><div class="main-container">zond</div></footer>
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
