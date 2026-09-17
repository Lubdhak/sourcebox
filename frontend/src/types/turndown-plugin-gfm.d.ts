// `turndown-plugin-gfm` ships no types of its own. Only the pieces we use are declared;
// the package also exports the individual rule sets, which we do not need because `gfm`
// is all of them.
declare module 'turndown-plugin-gfm' {
  import type TurndownService from 'turndown'

  export const gfm: TurndownService.Plugin
  export const tables: TurndownService.Plugin
  export const strikethrough: TurndownService.Plugin
  export const taskListItems: TurndownService.Plugin
}
