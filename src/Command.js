class Command {
  constructor(options = {}) {
    if (!options.name)    throw new Error('Command must have a name.');
    if (!options.execute) throw new Error('Command must have an execute function.');

    this.name        = options.name.toLowerCase();
    this.description = options.description || '';
    this.aliases     = (options.aliases || []).map(a => a.toLowerCase());
    this.execute     = options.execute;
  }

  matches(name) {
    return this.name === name || this.aliases.includes(name);
  }
}

module.exports = Command;
