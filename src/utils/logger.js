const format = (level, message, context = {}) => ({
  timestamp: new Date().toISOString(),
  level,
  message,
  ...context
});

const logger = {
  info(message, context) {
    console.log(JSON.stringify(format('info', message, context)));
  },
  warn(message, context) {
    console.warn(JSON.stringify(format('warn', message, context)));
  },
  error(message, context) {
    console.error(JSON.stringify(format('error', message, context)));
  }
};

module.exports = logger;
