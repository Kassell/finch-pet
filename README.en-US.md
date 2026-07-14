# Finch Pet

A desktop pet extension for Finch. It shows a floating Petdex-compatible pet on the desktop and lets the pet react to Finch agent activity.

Before showing the pet for the first time, import one with `pet_add` or ask Finch to add a Petdex pet from a page URL, image URL, local image, folder, or zip package.

## Features

- Show or hide a floating desktop pet.
- Drag the pet across displays.
- Click, double-click, or right-click to interact with it.
- Display short speech bubbles.
- React to Finch agent runtime states such as working, waiting, failed, and background-done.
- Import Petdex-compatible pets from local or remote sources.
- Manage the selected pet from Finch tools.

## Supported pet sources

`pet_add` supports:

- Petdex page URLs, for example `https://petdex.dev/pets/<slug>`
- Remote `.webp` / `.png` spritesheet URLs
- Local spritesheet images
- Local Petdex pet folders
- Local `.zip` pet packages

Spritesheets are parsed as a fixed **8 columns × 9 rows** grid. The base frame size is 192×208, but higher-resolution spritesheets using the same grid are supported.

## Tools

| Tool | Description |
|---|---|
| `pet_show` | Show the selected desktop pet. |
| `pet_hide` | Hide the desktop pet. |
| `pet_list` | List available pets. |
| `pet_select` | Select the active pet by name. |
| `pet_add` | Import a Petdex-compatible pet. |
| `pet_remove` | Remove a user-added pet from local storage. |
| `pet_set_state` | Play a Petdex animation state. |
| `pet_say` | Show a short speech bubble. |

If no pet is available, `pet_show` and `pet_list` report that a pet must be imported first.

## Permissions

This extension requests:

- `filesystem: readwrite` — store imported pets and read local pet packages.
- `network: true` — import remote Petdex pages and image URLs.
- `shell: true` — open local files or helper actions when needed by the extension runtime.

## Development

```bash
npm install
npm run build
```

The canvas bundle is generated from `canvas/` into `pet-canvas.js` during `npm run build`.

## License

This project is licensed under the [MIT License](LICENSE).
