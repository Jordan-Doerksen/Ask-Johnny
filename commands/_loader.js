const fs = require('fs');
const path = require('path');

// Discover every command file in this directory (skipping ones prefixed with
// "_") and collect their commands. A file may export a single command object
// { data, execute } or an array of them, so related commands can share a file.
function loadCommands() {
  const dir = __dirname;
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.js') && !f.startsWith('_'));

  const handlers = {}; // name -> command, for interaction dispatch
  const data = [];     // SlashCommandBuilder JSON, for REST registration

  for (const file of files) {
    const mod = require(path.join(dir, file));
    const commands = Array.isArray(mod) ? mod : [mod];
    for (const cmd of commands) {
      if (!cmd?.data) continue;
      handlers[cmd.data.name] = cmd;
      data.push(cmd.data.toJSON());
    }
  }

  return { data, handlers };
}

module.exports = { loadCommands };
