export const errorHandler = (err, req, res, next) => {
  // If the status code is still 200, default to a 500 Server Error
  const statusCode = res.statusCode === 200 ? 500 : res.statusCode;

  console.error(`[Error] ${err.message}`);

  res.status(statusCode).json({
    message: err.message,
    // Hide the stack trace in production to prevent leaking system architecture
    stack: process.env.NODE_ENV === "production" ? null : err.stack,
  });
};
