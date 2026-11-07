const agent = process.env.npm_config_user_agent ?? ''

if (!agent.startsWith('bun/')) {
  console.error('This repository uses Bun workspaces. Run `bun install`; npm, pnpm, and Yarn are unsupported.')
  process.exit(1)
}
