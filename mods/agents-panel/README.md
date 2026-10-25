# agents-panel

An **Agents** pane beside the Claude Code chat that tracks every subagent the Agent tool starts: its model,
effort, tokens, estimated cost, time and progress, grouped by run. Each agent is drawn as an animated pixel
character.

![The seven characters, with the commit and push stamps](../../docs/screenshots/agents-panel-characters.png)

*One frame of each character, rendered from the mod's own SVGs.*

- [Installation](#installation)
- [Usage](#usage)
- [Characters](#characters)
- [Configuration](#configuration)
- [How the numbers are measured](#how-the-numbers-are-measured)
- [Surfaces](#surfaces)
- [Limitations](#limitations)
- [Development](#development)
- [Version history](#version-history)
- [License](#license)

## Installation

```
/plugin install agents-panel --marketplace corneflex/claude-mods
```

Other ways to install, update and remove are in the [repository README](../../README.md#installation).

## Usage

The pane opens on its own when the Agent tool starts a new batch of subagents.

| Command | Does |
|---|---|
| `/agents-panel` | Opens the pane. |
| `/agents-panel clear` | Forgets past runs. |

Each batch of agents launched from one prompt is a **run**, titled with that prompt. A run shows:

- **Totals:** Cost, Tokens and Time tiles, summed across its agents.
- **Groups:** `▾ Running · n` and `▾ Finished · n`, each collapsible, and a **Collapse** toggle for the run.
- **One row per agent:**
  - its character and description;
  - a word for its effort level, `light` (low, green), `medium` (blue), `careful` (high, amber) or `heavy`
    (xhigh/max, orange), then its model, effort and agent type;
  - tool calls done, then `ctx % · tokens ≈$cost m:ss`;
  - a progress bar, and ✓ when it finishes (✗ if it failed or was interrupted).

## Characters

Within a run, each agent gets the next character in this list. Each character has its own look and motion,
and performs two tricks in a 6-second loop:

| Character | Look | Motion | Tricks |
|---|---|---|---|
| digger | miner's helmet with a lamp | lamp beam flickers, pickaxe swings, dirt flies | jump, dance |
| cowboy | wide-brim hat | lasso spins overhead, rides at a bounce, waves | double jump, side shuffle |
| police | cap and gold badge | red/blue siren flashes, arm directs traffic | dance, squat |
| nurse | white cap with a red cross | sways while hearts float up | side shuffle, jump |
| biker | helmet and visor | bounces on spinning wheels, speed lines stream past | jump, stomp |
| worker | hard hat and hi-vis vest | jackhammer shakes the sprite, dust puffs | stomp, jump |
| astronaut | helmet bubble and antenna | floats and drifts, antenna blinks, stars twinkle | double jump, squat |

Every character also blinks and breathes, out of step with the others, and casts a shadow that shrinks while
it is in the air. The characters never rotate or flip; only props such as the pickaxe and the wheels turn.

![Mid-trick: jumping, shuffling and squatting, with thought bubbles](../../docs/screenshots/agents-panel-tricks.png)

*One frame 1.5 seconds into the trick loop.*

The sprite also reacts to what the agent does:

| When the agent… | The sprite shows |
|---|---|
| waits on the model, with no tool running | a thought bubble with bouncing dots |
| runs `git commit` | a green ✓ stamp and falling confetti, three times |
| runs `git push` | an arrow rocketing up, three times |
| finishes | the character standing still |

## Configuration

Set options with `/plugin configure agents-panel@claude-mods` in a terminal session, or under `pluginConfigs`
in `~/.claude/settings.json`.

| Option | Default | Effect |
|---|---|---|
| `character` | `mixed` | `mixed` gives each agent in a run a different character. Name one (`digger`, `cowboy`, `police`, `nurse`, `biker`, `worker`, `astronaut`) to use it for every agent. |
| `motion` | `true` | Animates the characters. The commit and push stamps play either way. |
| `bodyColor` | `#E07F63` | Body colour, as hex. Any other value is ignored. |
| `animateFinished` | `false` | Keeps characters moving after their agent finishes. |

## How the numbers are measured

| Shown | Source |
|---|---|
| Tokens, ctx % | The size of the agent's latest request, as Claude Code reports `subagent_tokens`. ctx % assumes a 200k context window. |
| Cost | An estimate from each request's token usage at list prices: Opus $5/$25, Sonnet $3/$15, Haiku $1/$5 per million input/output tokens, with cache reads at 0.1× and cache writes at 1.25× the input price. Edit `PRICES` in `hooks/register.tsx` to change them. |
| Progress | Tool calls finished out of those started. A running agent's bar advances with time, since its total is unknown, and fills when it ends. |
| Time | From the agent's start to its end, or to now while it runs. |

In testing, tokens, tool counts and durations matched Claude Code's own completion reports to within about
100 tokens and 0.3 seconds.

## Surfaces

| Surface | Pane |
|---|---|
| Desktop app, VS Code | Full pane, with animated SVG characters and bars. |
| Terminal | Full pane, with a coloured marker for each agent and text bars; no animation. |

## Limitations

- Costs are estimates from list prices, not billing data.
- An agent keeps only its latest event: a push shortly after a commit replaces the commit stamp.
- Past runs stay in the pane until `/agents-panel clear`.

## Development

| Path | Contents |
|---|---|
| `hooks/register.tsx` | Hooks (agent spawn, model steps, tool calls, turn end), the pane, and the character SVGs. |
| `types/index.d.ts` | The state contract (`agents`, `runs`, `collapsed`, `now`). |
| `tests/pane.test.tsx` | Rows, totals, characters per agent, the `character` option and the commit stamp. |

```bash
claude plugin validate mods/agents-panel
```

```bash
claude plugin test mods/agents-panel
```

The mod also registers a read-only tool, `mcp__agents-panel__state`, that returns what the pane holds as JSON.

## Version history

| Version | Changes |
|---|---|
| 0.4.2 | MIT licence. |
| 0.4.1 | Characters move only in straight lines: no spinning or flipping. |
| 0.4.0 | Two tricks per character, blinking, breathing, shadows and the thinking bubble. |
| 0.3.0 | Seven characters with props, and the commit and push stamps. |
| 0.2.0 | Animated sprites and the first options. |
| 0.1.0 | The Agents pane: runs, totals, rows and progress. |

## License

[MIT](LICENSE).
