# Contributing

## Adding a mod

1. Create `mods/<name>/` with:
   - `.claude-plugin/plugin.json`: `name`, `version`, `description`, `author`, and `types` when the mod keeps
     state;
   - `hooks/hooks.json`: `{ "modules": ["./register.tsx"] }`;
   - `hooks/register.tsx`: the hooks module, exporting `register(on, options)`;
   - `types/index.d.ts`: the state contract, when the mod keeps values in `$.state`;
   - `tests/*.test.tsx`: tests for what the mod draws and records;
   - `README.md`: the mod's documentation (see below).
2. Add the mod to `.claude-plugin/marketplace.json`:

   ```json
   { "name": "<name>", "source": "./mods/<name>", "description": "<one line>" }
   ```

3. Add a row to the **Mods** table in the root `README.md`, linking to the mod's README.

## Checking a change

Run both before every commit:

```bash
claude plugin validate mods/<name>
```

```bash
claude plugin test mods/<name>
```

To try a mod in a session without installing it, start Claude Code with `--plugin-dir mods/<name>`.

## Versions

Raise `version` in the mod's `plugin.json` with every change people should receive, and add a line to the
version history in its README. `claude plugin update` only picks up a new version.

## Documentation

Each piece of information lives in one place:

| Where | What |
|---|---|
| Root `README.md` | What the repository is, the list of mods, requirements, installation, layout and licence. |
| `mods/<name>/README.md` | Everything about one mod: usage, features, configuration, surfaces, limitations, development, third-party code and version history. |
| `CONTRIBUTING.md` | How to add or change a mod. |

A mod's README follows this order, leaving out sections that do not apply: Installation, Usage, features,
Configuration, Surfaces, Limitations, Development, Third-party code, Version history.

Images go in `docs/screenshots/`. Say under each image whether it is a screen capture or a render.

## Dependencies

A mod cannot install npm packages: its hooks module can only import the mod's own files. To use a library,
bundle it in `hooks/vendor/` as an ES module, keep its licence file beside it, and name it under
**Third-party code** in the mod's README.
