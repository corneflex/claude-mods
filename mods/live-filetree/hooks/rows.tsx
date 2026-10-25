import type { ClientModule } from 'claude-code'

// One run of text in a row. `sh` names a shimmer palette (the letters light up in a moving band),
// `spin` appends a spinner frame; both animate here, in the surface, so the plugin never redraws for them.
export type Seg = { t: string; c?: string; b?: boolean; dim?: boolean; sh?: string; spin?: boolean }
export type RowSpec = { id: string; left: Seg[]; right: Seg[] }
export type RowsProps = { rows: RowSpec[]; hoverBg: string; palettes: Record<string, string[]>; empty?: string }
type Local = { phase: number; hover: number; ref: { stop?: () => void } }

const TICK_MS = 90
const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

function band(i: number, phase: number, len: number, palette: string[]) {
  const centre = ((phase * 1.4) % (len + 8)) - 4
  const d = Math.abs(i - centre)
  return palette[d < 0.8 ? 3 : d < 1.8 ? 2 : d < 2.8 ? 1 : 0] ?? palette[0]
}

const Rows: ClientModule<RowsProps, Local> = (props, surface) => {
  const { Box, Text } = surface.elements
  let state = surface.state
  if (state === undefined) {
    state = { phase: 0, hover: -1, ref: {} }
    surface.setState(state)
  }
  const animated = props.rows.some(r => [...r.left, ...r.right].some(s => s.sh || s.spin))
  if (animated && !state.ref.stop) {
    state.ref.stop = surface.every(TICK_MS, () => {
      const cur = surface.state
      if (cur) surface.setState({ ...cur, phase: cur.phase + 1 })
    })
  } else if (!animated && state.ref.stop) {
    state.ref.stop()
    state.ref.stop = undefined
  }
  surface.onPointer(e => {
    const cur = surface.state ?? state
    if (e.type === 'leave' || e.y < 0 || e.y >= props.rows.length) {
      if (cur.hover !== -1) surface.setState({ ...cur, hover: -1 })
      return
    }
    if (e.type === 'move' && cur.hover !== e.y) surface.setState({ ...cur, hover: e.y })
    const row = props.rows[e.y]
    if (e.type === 'down' && (e.button ?? 'left') === 'left' && row?.id) surface.post({ press: row.id })
  })

  const phase = state.phase
  const draw = (s: Seg) => {
    const palette = s.sh ? props.palettes[s.sh] : undefined
    if (palette) {
      const chars = [...s.t]
      return <Text bold={s.b}>{chars.map((ch, i) => <Text color={band(i, phase, chars.length, palette)}>{ch}</Text>)}</Text>
    }
    const text = s.spin ? `${s.t}${FRAMES[phase % FRAMES.length]}` : s.t
    return <Text color={s.c} bold={s.b} dimColor={s.dim}>{text}</Text>
  }

  if (props.rows.length === 0) return <Text dimColor>{props.empty ?? ''}</Text>
  return (
    <Box flexDirection="column">
      {props.rows.map((r, i) => (
        <Box flexDirection="row" height={1} overflow="hidden" backgroundColor={i === state.hover ? props.hoverBg : undefined}>
          <Box flexShrink={1} overflow="hidden">{r.left.map(draw)}</Box>
          <Box flexGrow={1} />
          {r.right.map(draw)}
        </Box>
      ))}
    </Box>
  )
}

export default Rows
