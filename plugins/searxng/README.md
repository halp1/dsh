# dsh-plugin-searxng

A [SearXNG](https://github.com/searxng/searxng) search provider for DeepSeek
Harness. It registers with the `ctx.web` seam, so the built-in `web_search` tool
works with no API key, no quota, and no per-query cost.

SearXNG is a self-hostable metasearch engine: one query fans out to Google, Bing,
DuckDuckGo, Brave and others, and the merged, de-duplicated results come back as
JSON. This plugin maps that JSON to the seam's `{ url, title, snippet,
publishedAt }` sources, and passes instant answers (calculator, conversions)
through as `content`.

## Install

```sh
dsh plugin --profile web add file:~/code/dsh/plugins/searxng
```

The bundle patch does two things:

1. mounts the provider as `web-search-searxng`, pointed at `baseURL`;
2. sets `web.searchProvider: searxng`.

The second one matters. The shipped DeepSeek provider pins itself as the search
backend and needs a `DEEPSEEK_API_KEY`. Without the pin, every search keeps
going to it and fails with `WEB_PROVIDER_CREDENTIAL_MISSING`.

## SearXNG requirement

`json` must be enabled in the instance's `settings.yml`; it is off by default:

```yaml
search:
  formats:
    - html
    - json
```

If it isn't, the instance answers `403` and the plugin's error tells you so.
If the instance has its bot limiter on and returns `429`, allow your address.

## Configuration

Override the `web-search-searxng` id from the profile's `cordis.patch.yml`:

```yaml
- id: web-search-searxng
  config:
    baseURL: https://searxng.example.com   # default: $SEARXNG_URL or http://localhost:8080
    timeoutMs: 15000
    categories: [general]                  # SearXNG categories
    engines: [google, duckduckgo]          # restrict upstream engines
    language: en
    safeSearch: 0                          # 0 off, 1 moderate, 2 strict
    timeRange: month                       # day | month | year
    headers: { Authorization: "Bearer …" } # e.g. for an instance behind auth
```

All fields except `baseURL` are optional. Settings are read at startup.

## Behavior

- **Failures are explained.** A refused connection, timeout, non-JSON body, 403
  and 429 each produce a distinct `WebError` naming the instance and the likely fix.
- **Empty is not an error, unless it is a lie.** Zero results with every engine
  healthy is an empty result. Zero results because upstream engines timed out or
  hit a CAPTCHA is reported as an error naming those engines.
- **Cancellation is honored.** Aborting a turn aborts the HTTP request.
- **Snippets are capped** at 600 characters, with whitespace collapsed.

## Tests

```sh
pnpm install && pnpm test
```
