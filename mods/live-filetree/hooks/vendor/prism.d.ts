// Types for the vendored Prism bundle: only what live-filetree calls.
export type PrismToken = { type: string; content: string | PrismToken | (string | PrismToken)[]; alias?: string | string[] }
declare const Prism: {
  languages: Record<string, unknown>
  tokenize(text: string, grammar: unknown): (string | PrismToken)[]
}
export default Prism
