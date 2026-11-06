# dsh-plugin-wakatime

WakaTime heartbeats for DeepSeek Harness. Every file the agent reads or edits
(`read`, `write`, `edit`, `read_image`, `str_replace_editor`) is reported through
`wakatime-cli`, under the `ai coding` category by default.

Works with any WakaTime-compatible server (Hackatime, Wakapi, self-hosted).

## Install

```sh
dsh plugin --profile web add file:~/code/dsh/plugins/wakatime
```

It needs `wakatime-cli`. Any WakaTime editor plugin installs one at
`~/.wakatime/wakatime-cli`, or use `brew install wakatime-cli`.

## Configuration

With no config, `wakatime-cli` reads `api_url` and `api_key` from
`~/.wakatime.cfg`. To override, add a row to the profile's `cordis.patch.yml`:

```yaml
- id: wakatime
  config:
    apiUrl: https://hackatime.hackclub.com/api/hackatime/v1  # custom endpoint
    apiKey: your-key                # default: api_key from ~/.wakatime.cfg
    category: ai coding             # any wakatime-cli --category value
    cliPath: /opt/homebrew/bin/wakatime-cli
    enabled: true
```

All fields are optional.

## Behavior

- A heartbeat is sent when the agent touches a different file, writes a file,
  or keeps working in the same file for 2 minutes. This is the same throttle
  WakaTime editor plugins use.
- Failures never break a tool call. They are logged, and a missing CLI is
  reported once.
- Offline queueing and project detection are handled by `wakatime-cli`.

## Tests

```sh
npm test
```
