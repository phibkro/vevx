---
"@vevx/varp": patch
---

Fix MCP tool responses to always return structuredContent, ensuring clients receive typed JSON alongside the text fallback. Fixes outputSchema validation errors for tools with declared output schemas.
