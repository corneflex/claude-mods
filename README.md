# claude-mods

Mods for [Claude Code](https://claude.com/claude-code): small plugins that change Claude Code's own
interface or behaviour. This repository is a plugin marketplace, so each mod installs with one line.

| Mod | What it does |
|---|---|
| [agents-panel](mods/agents-panel) | A live **Agents** pane beside the chat that tracks every subagent: model, effort, tokens, cost, time and progress, grouped by run. |
| [live-filetree](mods/live-filetree) | A live **Files** pane: what Claude is reading, editing and creating right now, highlighted and animated in the file tree, with git status and click-to-diff. |

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install agents-panel --marketplace corneflex/claude-mods
/plugin install live-filetree --marketplace corneflex/claude-mods
```

Answer `y` to add the marketplace, then pick a scope (user scope loads it in every session).

From a shell:

```bash
claude plugin install agents-panel --marketplace corneflex/claude-mods
```

```bash
claude plugin install live-filetree --marketplace corneflex/claude-mods
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

### Sprites

![The seven characters, plus the commit and push stamps](docs/screenshots/agents-panel-characters.png)

*One frame of each character, rendered from the mod's own SVGs.*

Each agent in a run is a different character, and each one moves while its agent works:

| Character | Look | Motion |
|---|---|---|
| digger | miner's helmet with a lamp | lamp beam flickers, pickaxe swings, dirt flies |
| cowboy | wide-brim hat | lasso spins overhead, rides at a bounce, waves |
| police | cap and gold badge | red/blue siren flashes and glows, arm directs traffic |
| nurse | white cap with a red cross | sways side to side while hearts float up and fade |
| biker | helmet and visor | bounces on spinning wheels, speed lines stream past |
| worker | hard hat and hi-vis vest | jackhammer shakes the whole sprite, dust puffs |
| astronaut | helmet bubble and antenna | floats and drifts, antenna blinks, stars twinkle |

On top of its own move, every character performs two tricks in a 6-second loop:

| Character | Tricks |
|---|---|
| digger | jump, then dance |
| cowboy | double jump, then side shuffle |
| police | dance, then squat |
| nurse | side shuffle, then jump |
| biker | jump, then stomp |
| worker | stomp, then jump |
| astronaut | double jump, then squat |

The characters themselves never rotate or flip; only props such as the pickaxe and the bike's wheels turn.

They also blink and breathe, out of step with each other, and a shadow at their feet shrinks while they're
in the air. While an agent is waiting on the model, with no tool running, a thought bubble with bouncing
dots floats beside it.

![Mid-trick: jumping, shuffling and squatting, with the thought bubbles](docs/screenshots/agents-panel-tricks.png)

*One frame 1.5 seconds into the loop, rendered from the mod's own SVGs.*

**Commit and push.** When an agent runs `git commit`, a green ✓ stamp pops above its sprite and confetti
falls. When it runs `git push`, an arrow rockets up. Each plays three times and then fades out.

When an agent finishes, its character stands still.

To customize them, use the plugin's settings: `/config` in a terminal, or `pluginConfigs` in
`~/.claude/settings.json`:

| Option | Default | What it does |
|---|---|---|
| `character` | `mixed` | `mixed` gives each agent in a run a different character; name one to dress every sprite the same. |
| `motion` | `true` | Animates the characters. The commit and push stamps play either way. |
| `bodyColor` | `#E07F63` | The critters' body colour (hex). A value that isn't hex is ignored. |
| `animateFinished` | `false` | Keeps characters moving after their agent finishes. |

### Surfaces

The pane draws on the desktop app (with the avatars and bars as SVG, animated) and in the terminal (text
bars, no animation).

---

## live-filetree

![Files pane mockup](docs/screenshots/live-filetree.png)

*Mockup drawn from the data recorded during a real live check (two reads, then a new file created and
edited). In the app the highlighted name animates. A screenshot of the pane will replace it.*

A **Files** pane that opens beside the chat in the desktop app (`/live-files` opens it anywhere).

**Status card.** What Claude is doing right now, then what it did when the turn ends, acted out by an animated
pixel Claude:

![The seven Claude scenes](docs/screenshots/live-filetree-claude.png)

*One frame of each scene, rendered from the mod's own SVGs.*

| State | Card says | Claude… |
|---|---|---|
| thinking | `Claude is thinking` | paces, glances around and taps its chin; its thought bubble goes `?`, `…`, `!`, then a lightbulb pings |
| reading | `Claude is reading 3 files` / `Claude read 3 files` | wears glasses over an open book, eyes scanning line by line, pages flipping, a "hmm…" |
| editing | `Claude is editing client.js` / `Claude edited 1 file` | types furiously at a keyboard while code types itself into a little editor, sweating |
| creating | `Claude is creating notes.md` / `Claude created 1 file` | swings a hammer as blocks drop onto a stack, sparks flying |
| committed | `Claude committed 2 files` + short hash | leaps with arms up under a popping ✓ stamp and raining confetti |
| idle | `Waiting for you` | dozes, breathing slowly, Z's drifting up |
| answered | `Claude answered` | waves with happy eyes and a "Done!" speech bubble |

Claude only moves in straight lines (it never spins or flips); props such as the hammer turn. The terminal
shows a plain marker instead of the animation.

Below it are the branch and how far it's ahead (`main ↑1`), then `clean, nothing changed` or
`+A -D · N changed`. A legend shows the colours for Claude read, Claude edited and Not committed.

**Tools.**
- *Find a file* searches every tracked and untracked file.
- *Refresh*, *Collapse all* and *Show sizes / dates*.
- *Up a folder*, *Back to project* and *Hide / Show hidden files*.

**Claude touched.** Every file Claude read, edited, created or committed during the current prompt. Each one
shows a coloured file-type label (`JS`, `TS`, `MD`, `PY`…), its folder, `+/-` line counts, and a coloured text badge with no background: `◉ Opened`, `✎ Edited`,
`✚ Created` or `✓ Committed`.

**All files.** The project tree, with file-type labels and each file's date or size.

**Live highlight.** While Claude works on a file, and for 8 seconds after (a read or an edit takes only
milliseconds), its name in both lists lights up: purple for reading, orange for editing, green for creating.
The status card's Claude acts out the same state meanwhile.
- A bright band sweeps along the file name letter by letter.
- A spinner turns beside the `reading` / `editing` / `creating` label.

The rows animate inside the pane's own drawing, so the tree no longer flickers while it updates.

**Diff screen.** Click any file with changes to open a full-screen diff in the style of VS Code:
- **Header:** a *← Files* button (or `b`) that returns to the tree, the file's type label, name, folder and
  `+/-` counts.
- **Body:** line numbers in the gutter, removed lines on red, added lines on green, blue hunk headers, and
  **syntax colours** on every line in VS Code's Dark+ theme. Each hunk's old and new sides are highlighted as
  whole blocks, so multi-line strings and comments colour correctly.
- **Layout:** *Side by side* (or `v`) puts HEAD on the left and the working tree on the right; *Inline*
  shows one column. Side by side is the default when the pane is wide.
- **New files:** show as all-added lines.

**Code reader.** A file with no changes opens in a reader with line numbers and the same Dark+ syntax colours
(up to 1,000 lines). It covers about 25 languages, including JS/TS/JSX/TSX, JSON, Markdown, Python, shell,
YAML, TOML, Rust, Go, Java, Kotlin, Swift, C/C++, C#, Ruby, PHP, SQL, HTML/XML and CSS.

**Markdown reader.** A Markdown file with no changes opens rendered, with headings, lists, tables, code and
links, drawn by Claude Code's own Markdown renderer. *Source* (or `p`) switches to the coloured source.

Syntax highlighting uses [Prism](https://prismjs.com) 1.29.0 (MIT). A mod can't install npm packages, so its
core and language grammars are bundled in `mods/live-filetree/hooks/vendor/prism.js`, with its licence beside
it in `PRISM-LICENSE`.

Git status refreshes every 5 seconds and after every edit, write or shell command. The mod also registers
a read-only tool, `mcp__live-filetree__state`, which returns what the pane holds as JSON. The row animations
run in the desktop app and the terminal; VS Code shows the same rows without animation. Its one third-party dependency is the bundled Prism (MIT).

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
