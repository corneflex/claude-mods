# claude-mods

Mods for [Claude Code](https://claude.com/claude-code): small plugins that change Claude Code's own
interface or behaviour. This repository is a plugin marketplace, so each mod installs with one line.

| Mod | What it does |
|---|---|
| [agents-panel](mods/agents-panel) | A live **Agents** pane beside the chat that tracks every subagent: model, effort, tokens, cost, time and progress, grouped by run. |

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install agents-panel --marketplace corneflex/claude-mods
```

Answer `y` to add the marketplace, then pick a scope (user scope loads it in every session).

From a shell:

```bash
claude plugin install agents-panel --marketplace corneflex/claude-mods
```

In the desktop app, where `/plugin` does not run: click **+** next to the prompt box, then **Plugins**,
**Add marketplace** with `corneflex/claude-mods`, then **Add plugin**. A mod installed from a terminal at
the user scope also loads in the desktop app's Code tab.

---

## agents-panel

![Agents pane mockup](docs/screenshots/agents-panel.png)

*Mockup drawn from the data recorded during a real test run of three subagents. A screenshot of the pane in
the app will replace it.*

When the Agent tool starts a subagent, the pane opens beside the chat and adds a row for it. Each batch of
agents launched from one prompt is a run with:

- **Title**: the prompt that launched it.
- **Totals**: Cost, Tokens and Time tiles, summed across the run's agents.
- **Groups**: `▾ Running · n` and `▾ Finished · n`, each collapsible, plus a **Collapse** toggle for the run.
- **One row per agent**:
  - a pixel-art critter avatar
  - the agent's description
  - a tag word for its effort level: `light` for low (green), `medium` (blue), `careful` for high (amber),
    `heavy` for xhigh/max (orange)
  - the model, effort and agent type
  - tool calls done
  - `ctx % · tokens ≈$cost m:ss`
  - a progress bar, and ✓ when done (✗ if it failed or was interrupted)

### Commands

| Command | Does |
|---|---|
| `/agents-panel` | Opens the pane. |
| `/agents-panel clear` | Forgets past runs. |

The mod also registers a read-only tool, `mcp__agents-panel__state`, which returns what the pane holds as
JSON so Claude can check the numbers.

### How the numbers are measured

| Shown | Source |
|---|---|
| Tokens, ctx % | The size of the agent's latest request, as Claude Code reports `subagent_tokens`. ctx % assumes a 200k context window. |
| Cost | An estimate from each request's token usage at list prices: Opus $5/$25, Sonnet $3/$15, Haiku $1/$5 per million input/output tokens; cache reads at 0.1× and cache writes at 1.25× the input price. Edit `PRICES` in `hooks/register.tsx` to change them. |
| Progress | Tool calls finished out of those started. The bar for a running agent advances with time, since its total is unknown, and fills when it ends. |
| Time | From the agent's start to its end (or now while running). |

In testing, tokens, tool counts and durations matched Claude Code's own completion reports to within about
100 tokens and 0.3 seconds.

### Surfaces

The pane draws on the desktop app (with the avatars and bars as SVG) and in the terminal (text bars).

---

## Adding a mod

Each mod lives in `mods/<name>/` with its own `.claude-plugin/plugin.json` and `hooks/`. List it in
`.claude-plugin/marketplace.json`:

```json
{ "name": "<name>", "source": "./mods/<name>", "description": "<one line>" }
```

Check it before pushing:

```bash
claude plugin validate mods/<name>
```
