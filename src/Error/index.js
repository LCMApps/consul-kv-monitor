const ExtendableError = require('./ExtendableError');

class WatchError extends ExtendableError {}
class WatchTimeoutError extends ExtendableError {}
class AlreadyInitializedError extends ExtendableError {}
class InvalidDataError extends ExtendableError {}


module.exports = {
    WatchError,
    WatchTimeoutError,
    AlreadyInitializedError,
    InvalidDataError
};
