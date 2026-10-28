class ApiError extends Error {
  constructor(statusCode, message, details) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
  }
}

const fail = (status, message, details) => {
  throw new ApiError(status, message, details);
};

module.exports = ApiError;
module.exports.fail = fail;
