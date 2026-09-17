# duckmail

Generate [DuckDuckGo Email Protection](https://duckduckgo.com/email/) private addresses (`@duck.com`) from the command line. No dependencies. Works on Windows, macOS, and Linux.

```sh
npx duckmail
```

## Requirements

- [Node.js](https://nodejs.org/) 20.12 or newer
- A DuckDuckGo Email Protection account

## Setup

1. Get your bearer token:
   1. Log in at <https://duckduckgo.com/email/settings/autofill>.
   2. Open your browser's DevTools and go to the **Network** tab.
   3. Click **Generate Private Duck Address**.
   4. Select the `POST` request to `quack.duckduckgo.com/api/email/addresses`.
   5. Copy the value after `Bearer ` in the `authorization` request header.

2. Save it:

   ```sh
   npx duckmail login
   ```

   Paste the token when prompted. It's stored in your user config folder:

   | OS            | Location                                       |
   | ------------- | ---------------------------------------------- |
   | Windows       | `%APPDATA%\duckmail\config.json`               |
   | macOS / Linux | `$XDG_CONFIG_HOME/duckmail/config.json` (defaults to `~/.config/duckmail/config.json`) |

## Usage

```sh
npx duckmail           # generate one address
npx duckmail 5         # generate five addresses (max 10 per run)
npx duckmail logout    # remove the saved token
npx duckmail --help
```

Example output:

```
abc1234x@duck.com
(copied to clipboard)
```

The script prints each address on its own line. The clipboard note goes to stderr, so piping the output only passes on the addresses:

```sh
npx duckmail 3 > emails.txt
```

To skip `npx` and get a permanent `duckmail` command, install it globally:

```sh
npm install -g duckmail
```

### Token lookup

The token is read from the first of these that's set:

1. the `BEARER_TOKEN` environment variable
2. a `.env` file in the current directory containing `BEARER_TOKEN="..."`
3. the token saved with `duckmail login`

## Clipboard

Generated addresses are copied to your clipboard when a clipboard tool is available:

| OS      | Tool                                          |
| ------- | --------------------------------------------- |
| Windows | `clip` (built in)                             |
| macOS   | `pbcopy` (built in)                           |
| Linux   | `wl-copy` (Wayland), `xclip`, or `xsel` (X11) |

On Linux, install one of those tools to enable copying. Without one, the addresses are still printed.

## Errors

The command exits with a non-zero status when:

- no token is found
- the count isn't a positive integer or is greater than 10
- the API request fails (for example, the token is invalid or expired)
- the response doesn't contain an address

## Security

Your bearer token gives access to your Duck address account. Don't share it or commit it. The saved config file is created readable only by your user on macOS and Linux.

## Development

```sh
git clone <repo-url>
cd duck-mail-generator
cp .env.example .env    # add your token
node generate.js
```

### Tests

```sh
npm test
```

Tests use Node's built-in test runner and a local mock server, so they never call the real DuckDuckGo API or create real addresses.

### Publishing

```sh
npm login
npm publish
```

Bump `version` in `package.json` before each new release (`npm version patch`).

## License

[MIT](LICENSE) © Fahmi Aulia Rahman
