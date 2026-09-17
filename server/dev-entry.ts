import { startDevelopmentServer } from './dev.js'

void startDevelopmentServer().catch(error => {
  console.error(error)
  process.exit(1)
})
