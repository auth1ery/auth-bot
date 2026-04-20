class Message {
  constructor(data, client) {
    this.id        = data.id;
    this.username  = data.username || data.from;
    this.from      = data.from || data.username;
    this.to        = data.to || null;
    this.color     = data.color;
    this.text      = data.text;
    this.channel   = data.channel || null;
    this.nodeId    = data.nodeId || null;
    this.timestamp = data.timestamp;
    this.replyTo   = data.replyTo || null;
    this.fileUrl   = data.fileUrl || null;
    this.fileType  = data.fileType || null;
    this._client   = client;
    this._type     = data.type;
  }

  reply(text) {
    if (this._type === 'dm') {
      this._client.sendDM(this.from, text);
    } else if (this._type === 'node_message') {
      this._client.sendToNode(this.nodeId, this.channel, text, { replyTo: { id: this.id, username: this.username, text: this.text } });
    } else {
      this._client.send(this.channel || 'global', text, { replyTo: { id: this.id, username: this.username, text: this.text } });
    }
  }

  delete() {
    if (this._type === 'node_message' && this.nodeId) {
      this._client.deleteMessage(this.nodeId, this.id);
    }
  }
}

module.exports = Message;
