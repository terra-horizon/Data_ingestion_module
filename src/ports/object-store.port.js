class ObjectStorePort {
  async putObject() {
    throw new Error('putObject must be implemented');
  }

  async statObject() {
    throw new Error('statObject must be implemented');
  }

  async getObject() {
    throw new Error('getObject must be implemented');
  }

  async deleteObject() {
    throw new Error('deleteObject must be implemented');
  }
}

module.exports = ObjectStorePort;
