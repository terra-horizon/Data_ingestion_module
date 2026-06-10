class BaseWrapper {
  supports() {
    throw new Error('supports must be implemented by wrappers');
  }

  transform() {
    throw new Error('transform must be implemented by wrappers');
  }
}

module.exports = BaseWrapper;
