export function layout(title: string, content: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} — apitool</title>
  <link rel="stylesheet" href="/static/style.css">
  <script src="https://unpkg.com/htmx.org@2.0.4"></script>
</head>
<body>
  <nav class="navbar">
    <div class="nav-brand">apitool</div>
    <div class="nav-links">
      <a href="/">Dashboard</a>
      <a href="/runs">Runs</a>
      <a href="/environments">Environments</a>
      <a href="/explorer">Explorer</a>
    </div>
  </nav>
  <main class="container">
    ${content}
  </main>
  <footer class="footer">
    <div class="container">apitool v0.1.0</div>
  </footer>
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
